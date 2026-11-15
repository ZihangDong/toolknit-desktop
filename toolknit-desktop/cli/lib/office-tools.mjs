import { operation, schema, inputPath, outputPath, overwrite } from './operation-schema.mjs';
export const OFFICE_OPERATIONS = [
  operation('word_to_pdf', ['word', 'to-pdf'], 'Convert local DOC/DOCX documents to searchable PDF using LibreOffice with UNO/Python. Single input_path/output_path or up to 20 input_paths/output_dir; batch failures are returned per file, successful files survive cancellation. 50 MiB per input. Macro execution and external updates disabled; DOCX external resources, embedded objects and macros rejected. No ZIP input or encrypted documents; fonts/layout may differ.',
    schema({ input_path: inputPath, output_path: outputPath, overwrite,
      input_paths: { type: 'array', minItems: 1, maxItems: 20, items: inputPath }, output_dir: inputPath }, [],
      { oneOf: [{ required: ['input_path', 'output_path'] }, { required: ['input_paths', 'output_dir'] }] }), './word-runtime.mjs', 'word_to_pdf', { readOnly: false }),
  operation('excel_to_pdf', ['excel', 'to-pdf'], 'Convert an explicit .xlsx workbook to PDF with an installed LibreOffice runtime in an isolated temporary profile. Preserves workbook print layout; rejects macros, embedded objects and external data connections. WPS/Microsoft Office are not substitutes.',
    schema({ input_path: inputPath, output_path: outputPath, overwrite }, ['input_path', 'output_path']), './office-runtime.mjs', 'excel_to_pdf', { readOnly: false }),
  operation('markdown_html', ['markdown', 'html'], 'Export local UTF-8 Markdown as standalone HTML with tables, task lists and MathML formulas. Raw HTML is escaped, images are represented by their alt text, Mermaid remains code; no browser or network is used.',
    schema({ input_path: inputPath, output_path: outputPath, title: { type: 'string', maxLength: 200 }, overwrite }, ['input_path', 'output_path']), './office-runtime.mjs', 'markdown_html', { readOnly: false })
];
