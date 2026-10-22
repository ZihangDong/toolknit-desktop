import sharp from 'sharp';
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import JSZip from 'jszip';
import path from 'node:path';
import { loadCore } from './core-loader.mjs';
import { scanCanvas } from './document-engine.mjs';
import { ToolKnitError } from './errors.mjs';

const MAX_PIXELS = 40_000_000;
const MAX_OUTPUT = 100 * 1024 * 1024;
function raster(bytes, extra = {}) { return sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error', ...extra }); }
function animatedPng(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new ToolKnitError('INPUT_INVALID', 'PNG chunks are damaged.');
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += length + 12;
  }
  return false;
}
async function inspect(input, framePolicy = 'reject', tiffAll = false) {
  let bytes = Buffer.from(input.bytes);
  if (bytes[0] === 66 && bytes[1] === 77) {
    const { readRasterDimensions } = await loadCore('core/image-dimensions.js'), size = readRasterDimensions(bytes, 'bmp');
    if (!size || size.width * size.height > MAX_PIXELS || Math.max(size.width, size.height) > 32768) throw new ToolKnitError('INPUT_TOO_LARGE', 'Bitmap dimensions exceed limits.');
    const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height);
    try { canvas.getContext('2d').drawImage(image, 0, 0); bytes = canvas.toBuffer('image/png'); }
    finally { canvas.width = canvas.height = 0; }
  }
  const meta = await raster(bytes).metadata();
  if (!['png', 'jpeg', 'webp', 'gif', 'tiff'].includes(meta.format)) throw new ToolKnitError('INPUT_INVALID', 'Unsupported raster image format.');
  const width = meta.width, height = meta.pageHeight || meta.height;
  if (![width, height].every(Number.isSafeInteger) || width * height > MAX_PIXELS || Math.max(width, height) > 32768) throw new ToolKnitError('INPUT_TOO_LARGE', 'Image dimensions exceed 40 megapixels or 32768 pixels per side.');
  const pages = meta.pages || 1, animated = animatedPng(bytes) || pages > 1 && !(meta.format === 'tiff' && tiffAll);
  if (animated && framePolicy !== 'first') throw new ToolKnitError('INPUT_INVALID', 'Multi-frame input requires explicit frame_policy=first; animation is not preserved.');
  if (pages > 100) throw new ToolKnitError('INPUT_TOO_LARGE', 'Image has more than 100 frames/pages.');
  return { bytes, meta, count: meta.format === 'tiff' && tiffAll ? pages : 1, first_frame: animated };
}
function encode(pipeline, format, quality = 90, lossless = false) {
  if (format === 'jpg' || format === 'jpeg') return pipeline.flatten({ background: '#fff' }).jpeg({ quality });
  if (format === 'webp') return pipeline.webp({ quality, lossless });
  if (format === 'gif') return pipeline.gif();
  return pipeline.png({ compressionLevel: 9 });
}
async function convert(job, args) {
  const source = await inspect(args.input, args.frame_policy), format = job === 'image_compress'
    ? (source.meta.format === 'jpeg' ? 'jpg' : source.meta.format) : args.format;
  const quality = job === 'image_compress' ? ({ high: 90, medium: 75, low: 60 }[args.quality ?? 'medium']) : args.quality ?? 90;
  let data, info;
  if (format === 'bmp') {
    const bmp = await import('bmp-ts');
    const raw = await raster(source.bytes).autoOrient().flatten({ background: '#fff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const abgr = Buffer.alloc(raw.data.length);
    for (let i = 0; i < raw.data.length; i += 4) { abgr[i] = raw.data[i + 3]; abgr[i + 1] = raw.data[i + 2]; abgr[i + 2] = raw.data[i + 1]; abgr[i + 3] = raw.data[i]; }
    data = bmp.encode({ data: abgr, width: raw.info.width, height: raw.info.height, bitPP: 24 }).data; info = raw.info;
  } else if (format === 'svg') {
    const png = await raster(source.bytes).autoOrient().png().toBuffer({ resolveWithObject: true }); info = png.info;
    data = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}"><image width="${info.width}" height="${info.height}" href="data:image/png;base64,${png.data.toString('base64')}"/></svg>`);
  } else ({ data, info } = await encode(raster(source.bytes).autoOrient(), format, quality, job === 'image_compress' && format === 'webp').toBuffer({ resolveWithObject: true }));
  if (data.length > MAX_OUTPUT) throw new ToolKnitError('PROCESSING_FAILED', 'Image output exceeds 100 MiB.');
  return { bytes: job === 'image_compress' && data.length >= args.input.bytes.length ? null : Uint8Array.from(data),
    meta: { format, width: info.width, height: info.height, source_bytes: args.input.bytes.length, candidate_bytes: data.length, first_frame: source.first_frame,
      lossless: format === 'png' || job === 'image_compress' && format === 'webp' } };
}
async function crop(args) {
  const source = await inspect(args.input);
  // Materialize orientation first; crop coordinates refer to this visible image.
  const transformed = await raster(source.bytes).autoOrient().toBuffer();
  const pipeline = raster(transformed).rotate(args.rotation ?? 0).flop(Boolean(args.flip_horizontal)).flip(Boolean(args.flip_vertical));
  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
  const rect = args.rect;
  if (rect.x + rect.width > info.width || rect.y + rect.height > info.height) throw new ToolKnitError('INVALID_ARGUMENT', 'Crop rectangle exceeds the transformed image.');
  const bytes = await encode(raster(data).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }), args.output_extension).toBuffer();
  return { bytes: Uint8Array.from(bytes), meta: { width: rect.width, height: rect.height } };
}
async function replace(args) {
  const source = await inspect(args.input), core = await loadCore('features/image-color-replace/core.js');
  const { data, info } = await raster(source.bytes).autoOrient().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (args.smart && (!Number.isInteger(args.seed_x) || !Number.isInteger(args.seed_y))) throw new ToolKnitError('INVALID_ARGUMENT', 'Connected selection requires seed_x and seed_y.');
  if ((args.seed_x ?? 0) >= info.width || (args.seed_y ?? 0) >= info.height) throw new ToolKnitError('INVALID_ARGUMENT', 'Seed lies outside the image.');
  const converted = core.replaceImageColors(new Uint8ClampedArray(data), info.width, info.height,
    { source: core.hexToRgb(args.source), target: core.hexToRgb(args.target), threshold: args.threshold, softness: args.softness, smart: args.smart ?? false,
      seedX: args.seed_x, seedY: args.seed_y, preserveLuminance: args.preserve_luminance ?? true });
  const bytes = await sharp(Buffer.from(converted.data), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { bytes: Uint8Array.from(bytes), meta: { width: info.width, height: info.height, changed_pixels: converted.changedPixels } };
}
async function icons(args) {
  const source = await inspect(args.input), core = await loadCore('features/icon-generator/core.js'), zip = new JSZip(), pngs = [];
  core.assertIconSourceDimensions(source.meta.width, source.meta.height);
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const data = await raster(source.bytes).autoOrient().resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    zip.file(`icon-${size}.png`, data); if (size <= 256) pngs.push({ size, data });
    if (size === 1024) zip.file('icon.svg', core.createEmbeddedIconSvg(data.toString('base64')));
  }
  zip.file('icon.ico', core.encodeIco(pngs)); zip.file('favicon.ico', core.encodeIco(pngs.filter(item => item.size <= 48)));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); core.assertIconArchiveSize(bytes.length);
  return { bytes, meta: { entries: Object.keys(zip.files), source_width: source.meta.width, source_height: source.meta.height } };
}
async function pdf(args, options) {
  const core = await loadCore('features/image-to-pdf/core.js'), scan = await loadCore('core/pdf-scan.js');
  const { readImageResolution } = await loadCore('core/image-resolution.js');
  const { createScanWriter } = await loadCore('shared/scanned-pdf-writer.js');
  const settings = core.settingsFor(Object.fromEntries(['paper', 'orientation', 'margin', 'quality', 'mode'].filter(key => args[key] !== undefined).map(key => [key, args[key]])));
  const sources = [], plans = []; let count = 0;
  for (const input of args.inputs) {
    const source = await inspect(input, args.frame_policy, true); count += source.count;
    if (count > 100) throw new ToolKnitError('INPUT_TOO_LARGE', 'Images expand to more than 100 PDF pages.');
    sources.push({ input, ...source });
  }
  const writer = await createScanWriter(count); let ordinal = 0;
  for (const source of sources) for (let frame = 0; frame < source.count; frame++) {
    const { data, info } = await raster(source.bytes, { page: frame }).autoOrient().png().toBuffer({ resolveWithObject: true });
    const resolution = readImageResolution(source.input.bytes, path.extname(source.input.name).slice(1));
    const plan = core.pagePlan({ width: info.width, height: info.height, ...resolution,
      ...(source.meta.format === 'tiff' && source.meta.density ? { dpiX: source.meta.density, dpiY: source.meta.density } : {}) }, settings);
    const image = await loadImage(data), canvas = createCanvas(plan.pixelWidth, plan.pixelHeight), ctx = canvas.getContext('2d');
    try {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, plan.x * canvas.width / plan.width, plan.y * canvas.height / plan.height, plan.drawWidth * canvas.width / plan.width, plan.drawHeight * canvas.height / plan.height);
      await scanCanvas(canvas, { ...scan.DEFAULT_SCAN_SETTINGS, mode: settings.mode }, ++ordinal);
      const png = settings.quality === 'clear' && settings.mode !== 'natural';
      await writer.add({ [png ? 'png' : 'jpeg']: new Uint8Array(png ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', Math.round(core.QUALITY[settings.quality].jpeg * 100))), width: plan.width, height: plan.height });
      plans.push({ width: plan.width, height: plan.height, effective_dpi: plan.effectiveDpi, resolution_limited: plan.resolutionLimited });
      options.reportProgress?.(ordinal / count * 90, 'Composing image PDF pages.');
    } finally { canvas.width = canvas.height = 0; }
  }
  return { bytes: await writer.finish(), meta: { page_count: count, pages: plans, mode: settings.mode, first_frame_inputs: sources.filter(source => source.first_frame).length } };
}
export async function processImage(job, args, options) {
  if (job === 'image_convert' || job === 'image_compress') return convert(job, args);
  const operations = { image_crop: crop, image_color_replace: replace, image_icons: icons, image_to_pdf: pdf };
  if (!Object.hasOwn(operations, job)) throw new ToolKnitError('INVALID_ARGUMENT', 'Unknown image operation.');
  return operations[job](args, options);
}
