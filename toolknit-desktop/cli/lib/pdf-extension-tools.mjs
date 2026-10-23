import { operation, schema, inputPath, outputPath, overwrite, number, integer, choice } from './operation-schema.mjs';
const pages = { type: 'array', minItems: 1, maxItems: 300, uniqueItems: true, items: integer(1, 300) };
const define = (name, command, description, properties, required, network = false) => operation(name, ['pdf', command], description,
  schema(properties, required), './pdf-extension-runtime.mjs', name, { readOnly: false, network });
export const PDF_EXTENSION_OPERATIONS = [
  define('pdf_to_word', 'to-word', 'Convert a text-based PDF to editable DOCX with the desktop layout engine. Default offline; ai_mode=true explicitly sends selected text/region images to the environment-configured vision AI for layout classification. Complex regions may remain images; no scanned OCR. Scoped engine license applies.',
    { input_path: inputPath, output_path: outputPath, pages, layout: choice(['original', 'a4']), ai_mode: { type: 'boolean', default: false }, overwrite }, ['input_path', 'output_path'], true),
  define('pdf_text', 'text', 'Extract selectable PDF text and reconstruct local Markdown reading order and tables. Does not perform OCR. Returns status and publishes UTF-8 .md or .txt; no network.',
    { input_path: inputPath, output_path: outputPath, pages, overwrite }, ['input_path', 'output_path']),
  define('pdf_crop', 'crop', 'Crop selected PDF pages using a normalized rectangle in the rotated visible page: x/y at top-left, width/height in 0..1. Unselected pages remain. Cropping changes page boxes, NOT secure redaction.',
    { input_path: inputPath, output_path: outputPath, pages, rect: schema({ x: number(0, 1), y: number(0, 1), width: number(0.002, 1), height: number(0.002, 1) }, ['x', 'y', 'width', 'height']), overwrite }, ['input_path', 'output_path', 'rect']),
  define('pdf_page_number', 'page-number', 'Add page numbers locally. Reuses desktop position/rotation and font layout; source is unchanged. Form fields are flattened when copying pages.',
    { input_path: inputPath, output_path: outputPath, pages, start: integer(1, 999999), position: choice(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']), font_size: number(6, 72), margin: number(0, 144), template: { type: 'string', minLength: 1, maxLength: 100 }, overwrite }, ['input_path', 'output_path']),
  define('pdf_to_scan', 'to-scan', 'Create an image-only PDF with faithful, grayscale or natural scan appearance. This removes searchable text, links, annotations and form behavior. Explicit local operation, no OCR and no network.',
    { input_path: inputPath, output_path: outputPath, pages, mode: choice(['faithful', 'grayscale', 'natural']), dpi: choice([150, 200, 300]), overwrite }, ['input_path', 'output_path']),
  define('pdf_create', 'create', 'Create a blank PDF without uploading an existing file. A4 or letter, portrait or landscape; 1-100 pages.',
    { output_path: outputPath, page_count: integer(1, 100), paper: choice(['a4', 'letter']), orientation: choice(['portrait', 'landscape']), overwrite }, ['output_path'])
];
