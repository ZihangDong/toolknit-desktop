import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  copyFile,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  PageNumber,
  PageBreak,
} from 'docx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { word_to_pdf } from '../cli/lib/word-runtime.mjs';
import { resolveLibreOfficeRuntime } from '../cli/lib/ppt-render-runtime.mjs';
import JSZip from 'jszip';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const run = promisify(execFile),
  root = path.resolve('tmp/word-pdf-native');
await mkdir(root, { recursive: true });
const renderer = await resolveLibreOfficeRuntime();
assert.ok(renderer.available, 'Real LibreOffice required');
await run(path.join(path.dirname(renderer.command), process.platform === 'win32' ? 'python.exe' : 'python3'), ['scripts/test-word-to-pdf-profile.py'], { windowsHide: true, timeout: 30000 });
const source = path.join(root, '中文 文档.docx'),
  corrupt = path.join(root, '坏文件.docx'),
  empty = path.join(root, '空文件.docx');
const document = new Document({
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph('WORD_HEADER')] }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun('Page '),
                new TextRun({ children: [PageNumber.CURRENT] }),
              ],
            }),
          ],
        }),
      },
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: 'WORD_BODY 中文排版测试',
              font: 'Microsoft YaHei',
              size: 28,
            }),
          ],
        }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('TABLE_CELL_A')] }),
                new TableCell({ children: [new Paragraph('TABLE_CELL_B')] }),
              ],
            }),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph('SECOND_PAGE'),
      ],
    },
  ],
});
await writeFile(source, await Packer.toBuffer(document));
await writeFile(corrupt, 'not a document');
await writeFile(empty, '');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const original = hash(await readFile(source));
const legacy = path.join(root, 'legacy');
await mkdir(legacy, { recursive: true });
await run(
  renderer.command,
  [
    '--headless',
    '--nologo',
    '--nodefault',
    '--norestore',
    '-env:UserInstallation=' +
      pathToFileURL(path.join(root, 'legacy-profile')).href,
    '--convert-to',
    'doc:MS Word 97',
    '--outdir',
    legacy,
    source,
  ],
  { windowsHide: true, timeout: 120000 },
);
const old = path.join(legacy, '中文 文档.doc');
assert.ok((await readFile(old)).length > 0);
const outputs = path.join(root, 'cli');
await mkdir(outputs, { recursive: true });
const result = await word_to_pdf({
  input_paths: [source, old, corrupt, empty],
  output_dir: outputs,
});
await writeFile(
  path.join(root, 'cli-report.json'),
  JSON.stringify(result, null, 2),
);
assert.equal(result.status, 'partial');
assert.equal(result.outputs.length, 2);
assert.equal(result.files[2].status, 'failed');
assert.equal(result.files[3].status, 'failed');
async function inspect(file) {
  const loading = getDocument({
    data: new Uint8Array(await readFile(file)),
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const pdf = await loading.promise;
    assert.equal(pdf.numPages, 2);
    let text = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const v = page.getViewport({ scale: 1 });
      assert.ok(Math.abs(v.width - 595) < 2 && Math.abs(v.height - 842) < 2);
      text += (await page.getTextContent()).items.map((x) => x.str).join(' ');
    }
    for (const token of [
      'WORD_HEADER',
      'WORD_BODY',
      'TABLE_CELL_A',
      'TABLE_CELL_B',
      'SECOND_PAGE',
      '中文',
    ])
      assert.ok(text.includes(token), token);
    return { pages: pdf.numPages, bytes: (await readFile(file)).length };
  } finally {
    await loading.destroy();
  }
}
for (const output of result.outputs) await inspect(output.output_path);
const commandOutput = path.join(root, 'command-smoke.pdf');
const commandResult = await run(
  process.execPath,
  [
    path.resolve('cli/toolknit.mjs'),
    'word',
    'to-pdf',
    '--input',
    source,
    '--output',
    commandOutput,
    '--overwrite',
    '--json',
  ],
  { windowsHide: true, timeout: 180000 },
);
assert.equal(JSON.parse(commandResult.stdout).ok, true);
await inspect(commandOutput);
assert.notEqual(
  result.outputs[0].output_path.toLowerCase(),
  result.outputs[1].output_path.toLowerCase(),
  'same basename cannot overwrite',
);
for (const [label, patch, expected] of [
  [
    'macro',
    (zip) => zip.file('word/vbaProject.bin', 'blocked'),
    'active-content',
  ],
  [
    'embedded',
    (zip) => zip.file('word/embeddings/object.bin', 'blocked'),
    'active-content',
  ],
  [
    'external',
    (zip) =>
      zip.file(
        'word/_rels/document.xml.rels',
        '<Relationships><Relationship TargetMode="External" Type="image" Target="https://example.invalid/private.png"/></Relationships>',
      ),
    'external-content',
  ],
  [
    'entity',
    (zip) =>
      zip.file(
        'word/_rels/document.xml.rels',
        '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///not-read">]><Relationships/>',
      ),
    'invalid-document',
  ],
]) {
  const zip = await JSZip.loadAsync(await readFile(source));
  patch(zip);
  const dangerous = path.join(root, label + '.docx');
  await writeFile(dangerous, await zip.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(
    () =>
      word_to_pdf({
        input_path: dangerous,
        output_path: path.join(root, label + '.pdf'),
      }),
    (e) => e.message === `word-render:${expected}`,
  );
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('cli/toolknit.mjs'), 'mcp', 'serve'],
  stderr: 'pipe',
});
const client = new Client({ name: 'word-pdf-real-qa', version: '1.0.0' });
try {
  await client.connect(transport);
  assert.ok(
    (await client.listTools()).tools.some(
      (t) => t.name === 'toolknit_word_to_pdf',
    ),
  );
  const response = await client.callTool(
    {
      name: 'toolknit_word_to_pdf',
      arguments: { input_paths: [source], output_dir: outputs },
    },
    undefined,
    { timeout: 180000 },
  );
  assert.equal(response.isError, false, JSON.stringify(response));
  await inspect(response.structuredContent.result.outputs[0].output_path);
} finally {
  await client.close();
}
assert.equal(hash(await readFile(source)), original);
const single = path.join(root, 'single.pdf');
try {
  await word_to_pdf({ input_path: source, output_path: single });
} catch (e) {
  if (e.code !== 'OUTPUT_EXISTS') throw e;
}
await assert.rejects(
  () => word_to_pdf({ input_path: source, output_path: single }),
  (e) => e.code === 'OUTPUT_EXISTS',
);
const controller = new AbortController();
controller.abort();
await assert.rejects(
  () =>
    word_to_pdf(
      { input_path: source, output_path: path.join(root, 'cancelled.pdf') },
      { signal: controller.signal },
    ),
  (e) => e.code === 'CANCELLED',
);
if (!process.argv.includes('--cli-only')) {
  const output = await mkdtemp(path.join(os.tmpdir(), 'toolknit-word-native-'));
  const evidence = path.join(root, 'native');
  await mkdir(evidence, { recursive: true });
  await run(
    'cargo',
    [
      'test',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      'word_real_runtime_qa',
      '--lib',
      '--',
      '--ignored',
      '--nocapture',
    ],
    {
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        TOOLKNIT_WORD_QA_FILES: JSON.stringify([source, old, corrupt]),
        TOOLKNIT_WORD_QA_OUTPUT: output,
      },
    },
  );
  const native = JSON.parse(
    await readFile(path.join(output, 'report.json'), 'utf8'),
  );
  assert.equal(native.files.filter((x) => x.status === 'success').length, 2);
  assert.equal(native.files[2].status, 'failed');
  for (const [index, item] of native.files
    .filter((x) => x.outputPath)
    .entries()) {
    await inspect(item.outputPath);
    await copyFile(item.outputPath, path.join(evidence, `native-${index}.pdf`));
  }
  await writeFile(
    path.join(evidence, 'report.json'),
    JSON.stringify(
      {
        statuses: native.files.map((x) => x.status),
        cancelled: native.cancelled,
      },
      null,
      2,
    ),
  );
  await rm(output, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 150,
  });
}
await writeFile(
  path.join(root, 'verification.json'),
  JSON.stringify(
    {
      realDocx: true,
      realDoc: true,
      editableText: true,
      pages: 2,
      header: true,
      table: true,
      unicode: true,
      partialFailure: true,
      sourceUnchanged: true,
      overwriteBlocked: true,
      preAbort: true,
    },
    null,
    2,
  ),
);
console.log(
  'Real Word DOC/DOCX: native/CLI/MCP, text, Chinese, header, table, A4 pagination, partial failure, source preservation, overwrite protection and hostile DOCX rejection verified.',
);
