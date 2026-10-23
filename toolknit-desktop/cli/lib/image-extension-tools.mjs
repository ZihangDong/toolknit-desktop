import { operation, schema, inputPath, outputPath, overwrite, number, integer, choice } from './operation-schema.mjs';
const inputs = { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: inputPath };
const hex = { type: 'string', pattern: '^#[A-Fa-f0-9]{6}$' };
const define = (name, command, description, fields, required) => operation(name, ['image', command], description,
  schema(fields, required), './image-extension-runtime.mjs', name, { readOnly: false });
export const IMAGE_EXTENSION_OPERATIONS = [
  define('image_to_pdf', 'to-pdf', 'Convert ordered local images into a PDF, optionally with grayscale/natural scan appearance. PNG/JPEG/WebP/BMP/GIF and multi-page TIFF supported. Animated images require explicit frame_policy=first. Uses desktop page-size, DPI and scan algorithms; no OCR.',
    { input_paths: inputs, output_path: outputPath, paper: choice(['a4', 'original']), orientation: choice(['auto', 'portrait', 'landscape']), margin: choice([0, 8, 15]), quality: choice(['clear', 'balanced', 'small']), mode: choice(['faithful', 'grayscale', 'natural']), frame_policy: choice(['reject', 'first']), overwrite }, ['input_paths', 'output_path']),
  define('image_convert', 'convert', 'Convert 1-100 local raster images to PNG, JPEG, WebP, BMP, static GIF or SVG with an embedded PNG (not vector tracing). Preserves displayed dimensions/orientation; JPEG/BMP use white for transparency. Animated/multi-page sources require frame_policy=first. Unique outputs.',
    { input_paths: inputs, output_dir: outputPath, format: choice(['png', 'jpg', 'webp', 'bmp', 'gif', 'svg']), quality: integer(1, 100), frame_policy: choice(['reject', 'first']) }, ['input_paths', 'output_dir', 'format']),
  define('image_compress', 'compress', 'Optimize PNG/JPEG/WebP images locally, preserving dimensions. PNG/WebP are lossless; JPEG quality high/medium/low uses 90/75/60. Only smaller results are published; no-reduction creates no file. Animated sources are rejected.',
    { input_paths: inputs, output_dir: outputPath, quality: choice(['high', 'medium', 'low']) }, ['input_paths', 'output_dir']),
  define('image_crop', 'crop', 'Crop a static local image with integer pixel coordinates after EXIF orientation, optional quarter-turn and flips. Rectangle must lie inside the transformed image; source is preserved.',
    { input_path: inputPath, output_path: outputPath, rect: schema({ x: integer(0, 32768), y: integer(0, 32768), width: integer(1, 32768), height: integer(1, 32768) }, ['x', 'y', 'width', 'height']), rotation: choice([0, 90, 180, 270]), flip_horizontal: { type: 'boolean' }, flip_vertical: { type: 'boolean' }, overwrite }, ['input_path', 'output_path', 'rect']),
  define('image_color_replace', 'replace-color', 'Replace an explicit source color with a target using the desktop Lab-distance/edge-softness engine. Optional connected-region selection requires a pixel seed. Output is PNG and keeps alpha.',
    { input_path: inputPath, output_path: outputPath, source: hex, target: hex, threshold: number(.5, 100), softness: number(0, 100), smart: { type: 'boolean', default: false }, seed_x: integer(0, 32768), seed_y: integer(0, 32768), preserve_luminance: { type: 'boolean' }, overwrite }, ['input_path', 'output_path', 'source', 'target']),
  define('image_icons', 'icons', 'Create a ZIP with aspect-preserving transparent PNG icons, ICO/favicon and an embedded SVG wrapper from one static image. Reuses desktop ICO/SVG generation; no external assets.',
    { input_path: inputPath, output_path: outputPath, overwrite }, ['input_path', 'output_path'])
];
