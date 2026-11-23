import { operation, schema, inputPath, outputPath, overwrite } from './operation-schema.mjs';
export const OFFICE_OPERATIONS = [
  operation('word_to_pdf', ['word', 'to-pdf'], 'Convert local DOC/DOCX documents to searchable PDF using LibreOffice with UNO/Python. Single input_path/output_path, or DOC/DOCX/ZIP input_paths/output_dir with up to 20 Word documents after expansion and source de-duplication. ZIP: 50 MiB compressed, 1000 entries, 200 MiB expanded per archive and selected documents per batch; 50 MiB per Word file, no nested archive expansion, encrypted entries, links or unsafe paths. Invalid ZIPs and document failures are reported per source/entry; successful files survive cancellation. Macro execution and external updates disabled; DOCX external resources, embedded objects and macros rejected. Fonts/layout may differ. Optional centered text/PNG/JPEG watermark layers support opacity, rotation, width and page ranges; failures publish no PDF for the item.',
    schema({ input_path: inputPath, output_path: outputPath, overwrite,
      refresh_fields: { type: 'boolean', default: false, description: 'Opt in to bounded internal TOC, page-count/number, chapter and internal reference updates. External/DDE/database content, dates and unknown field types are never explicitly refreshed. Inspect per-file field_update counts; fonts and pagination may change.' },
      encryption: { type: 'object', additionalProperties: false, required: ['password'], description: 'Optional AES-256 encryption after conversion and watermarking. Passwords require 8 characters and at most 127 UTF-8 bytes, with no NUL/CR/LF. CLI secrets must use --arguments-stdin. Only encrypted, verified output is published; retry requires the password again. Up to 200 pages per encrypted document.', properties: {
        password: { type: 'string', minLength: 8, maxLength: 127, description: 'Secret opening password; never place in command arguments, paths, logs or files.' },
        permissions: { type: 'object', additionalProperties: false, properties: {
          printing: { enum: [false, 'lowResolution', 'highResolution'] }, copying: { type: 'boolean' }, modifying: { type: 'boolean' }, annotating: { type: 'boolean' }, fillingForms: { type: 'boolean' }, documentAssembly: { type: 'boolean' }, contentAccessibility: { const: true }
        } }
      } },
      watermark: { type: 'object', additionalProperties: false, description: 'Optional centered A4 watermark layer, uniformly fitted to each output page. Body text stays searchable. A failed watermark publishes no PDF for that item.', properties: {
        type: { type: 'string', enum: ['text', 'image'], default: 'text' }, text: { type: 'string', maxLength: 160 }, image_path: inputPath,
        opacity: { type: 'number', minimum: 0.05, maximum: 1, default: 0.2 }, angle: { type: 'number', enum: [-45, 0, 45], default: 45 },
        width: { type: 'number', minimum: 20, maximum: 80, default: 60 }, pages: { type: 'string', maxLength: 500, description: 'Blank for all pages, otherwise 1-based comma-separated pages/ranges, e.g. 1,3-5. An out-of-range page fails that document.' }
      } },
      input_paths: { type: 'array', minItems: 1, maxItems: 20, items: inputPath }, output_dir: inputPath }, [],
      { oneOf: [{ required: ['input_path', 'output_path'] }, { required: ['input_paths', 'output_dir'] }] }), './word-runtime.mjs', 'word_to_pdf', { readOnly: false }),
  operation('excel_to_pdf', ['excel', 'to-pdf'], 'Convert an explicit .xlsx workbook to PDF with an installed LibreOffice runtime in an isolated temporary profile. Preserves workbook print layout; rejects macros, embedded objects and external data connections. WPS/Microsoft Office are not substitutes.',
    schema({ input_path: inputPath, output_path: outputPath, overwrite }, ['input_path', 'output_path']), './office-runtime.mjs', 'excel_to_pdf', { readOnly: false }),
  operation('markdown_html', ['markdown', 'html'], 'Export local UTF-8 Markdown as standalone HTML with tables, task lists and MathML formulas. Raw HTML is escaped, images are represented by their alt text, Mermaid remains code; no browser or network is used.',
    schema({ input_path: inputPath, output_path: outputPath, title: { type: 'string', maxLength: 200 }, overwrite }, ['input_path', 'output_path']), './office-runtime.mjs', 'markdown_html', { readOnly: false })
];
