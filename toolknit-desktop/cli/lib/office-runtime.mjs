import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadCore } from './core-loader.mjs';
import { readInputFile, readTextInput, prepareOutputFile, writeOutputFile } from './safe-files.mjs';
import { renderOfficeToPdfFile, resolveLibreOfficeRuntime } from './ppt-render-runtime.mjs';
import { runDocumentWorker } from './document-worker.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

export async function excel_to_pdf(args, options) {
  const prepared = await prepareOutputFile(args.output_path, { extensions: ['.pdf'], inputPaths: [args.input_path], overwrite: args.overwrite, signal: options.signal });
  const input = await readInputFile(args.input_path, { extensions: ['.xlsx'], maxBytes: 50 * 1024 * 1024, signal: options.signal });
  await runDocumentWorker('workbook_inspect', { bytes: input.bytes }, options);
  const renderer = await resolveLibreOfficeRuntime(); throwIfAborted(options.signal);
  if (!renderer.available) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'Install LibreOffice or set TOOLKNIT_LIBREOFFICE_PATH to soffice. WPS is not this runtime.');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'toolknit-cli-excel-'));
  try {
    const source = path.join(temporary, 'input.xlsx'); await writeFile(source, input.bytes, { flag: 'wx', mode: 0o600 });
    const converted = await renderOfficeToPdfFile({ path: source, name: 'input.xlsx', manifest: {} }, temporary, 'result.pdf', { ...options, renderer });
    throwIfAborted(options.signal);
    const result = await readInputFile(converted.path, { extensions: ['.pdf'], maxBytes: 150 * 1024 * 1024, signal: options.signal });
    const output = await writeOutputFile(args.output_path, result.bytes, { prepared, signal: options.signal });
    return { tool: 'excel.to-pdf', output_path: output, outputs: [{ path: output, bytes: result.size }], page_count: converted.page_count,
      warnings: ['Uses workbook print areas and page setup. Fonts and LibreOffice versions can affect layout.'] };
  } catch (error) {
    if (error instanceof ToolKnitError && ['CANCELLED', 'OUTPUT_EXISTS', 'OUTPUT_INVALID', 'OUTPUT_WRITE_FAILED'].includes(error.code)) throw error;
    throw new ToolKnitError('PROCESSING_FAILED', 'LibreOffice could not render this workbook. No new PDF was published.');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export async function markdown_html(args, options) {
  const prepared = await prepareOutputFile(args.output_path, { extensions: ['.html'], inputPaths: [args.input_path], overwrite: args.overwrite, signal: options.signal });
  const text = await readTextInput({ input_path: args.input_path }, { ...options, maxBytes: 2 * 1024 * 1024 });
  const core = await loadCore('features/markdown-editor/core.js'), renderer = core.createMarkdownRenderer('mathml');
  renderer.renderer.rules.image = (tokens, index) => `[Image: ${renderer.utils.escapeHtml(tokens[index].content)}]`;
  const html = core.buildStandaloneMarkdownHtml({ title: args.title || path.basename(args.input_path), renderedHtml: renderer.render(text) });
  const output = await writeOutputFile(args.output_path, Buffer.from(html), { prepared, signal: options.signal });
  return { tool: 'markdown.html', output_path: output, outputs: [{ path: output, bytes: Buffer.byteLength(html) }], headings: core.extractMarkdownHeadings(text),
    warnings: ['External images are not embedded; Mermaid diagrams remain source code. Formulas use browser-native MathML.'] };
}
