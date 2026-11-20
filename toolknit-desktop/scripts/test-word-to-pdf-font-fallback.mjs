// Real Writer regression: font notices must correspond to substitutions in PDF.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Document, Header, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { word_to_pdf } from '../cli/lib/word-runtime.mjs';

const root = path.resolve('tmp/word-font-fallback');
await mkdir(root, { recursive: true });
const source = path.join(root, 'missing-fonts.docx');
const names = Array.from({ length: 32 }, (_, i) => `ToolKnitMissing${i}`);
const paragraph = (font, text) => new Paragraph({ children: [new TextRun({ text, font })] });
const document = new Document({ sections: [{
  headers: { default: new Header({ children: [paragraph('ToolKnitHeaderMissing', 'FONT_HEADER')] }) },
  children: [
    ...names.map((font, i) => paragraph(font, `FONT_BODY_${i}`)),
    paragraph('ToolKnitCJKMissing', '中文字体测试'),
    new Table({ rows: [new TableRow({ children: [new TableCell({
      children: [paragraph('ToolKnitTableMissing', 'FONT_TABLE')],
    })] })] }),
  ],
}] });
await writeFile(source, await Packer.toBuffer(document));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = hash(await readFile(source));

for (const batch of [false, true]) {
  const result = await word_to_pdf(batch
    ? { input_paths: [source], output_dir: root }
    : { input_path: source, output_path: path.join(root, 'single.pdf'), overwrite: true });
  assert.equal(result.status, 'success');
  const file = result.outputs[0];
  const notices = file.font_notices;
  assert(!notices.some(n => n.code.startsWith('font-check')), JSON.stringify(notices));
  for (const name of [...names, 'ToolKnitHeaderMissing', 'ToolKnitTableMissing']) {
    const notice = notices.find(n => n.font === name);
    assert.equal(notice?.code, 'missing-font', name);
    assert(notice.replacement, `${name} has a free replacement in the bundled runtime`);
  }
  assert(notices.some(n => n.font === 'ToolKnitCJKMissing'), 'CJK font is checked independently');
  assert(result.warnings.some(w => w.includes('Commercial font licenses')));
  assert(result.warnings.some(w => w.includes('ToolKnitHeaderMissing')));
  const pdfBytes = await readFile(file.output_path);
  const loading = getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0 });
  try {
    const pdf = await loading.promise;
    const text = [];
    for (let n = 1; n <= pdf.numPages; n++)
      text.push(...(await (await pdf.getPage(n)).getTextContent()).items.map(item => item.str));
    for (const token of ['FONT_HEADER', 'FONT_TABLE', 'FONT_BODY_31', '中文字体测试'])
      assert(text.join(' ').includes(token), token);
    const replacement = notices.find(n => n.font === names[0]).replacement.replaceAll(' ', '');
    assert(pdfBytes.toString('latin1').includes(replacement), `PDF embeds the selected font ${replacement}`);
  } finally { await loading.destroy(); }
  assert.equal(hash(await readFile(source)), original, 'source Word remains unchanged');
  await writeFile(path.join(root, batch ? 'batch-report.json' : 'single-report.json'), JSON.stringify(result, null, 2));
}
console.log('Word font fallback: real single/batch PDFs, body/header/table text, CJK notices, large status and original file preservation passed.');
