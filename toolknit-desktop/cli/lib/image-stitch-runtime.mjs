import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { calculateImageStitchLayout } from './core/image-stitch-core.js';
import { ToolKnitError } from './errors.mjs';

const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']);
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_FILES = 100;

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  }
}

function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
}

function report(options, progress, message) {
  options.reportProgress?.(Math.max(0, Math.min(100, progress)), message);
}

export function isAnimatedGifBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 14 || !/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) {
    throw new ToolKnitError('INPUT_INVALID', 'GIF input is damaged or has an invalid header.');
  }
  let offset = 13;
  const packed = buffer[10];
  if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
  let frames = 0;
  const skipSubBlocks = () => {
    while (offset < buffer.length) {
      const length = buffer[offset++];
      if (length === 0) return true;
      offset += length;
      if (offset > buffer.length) return false;
    }
    return false;
  };
  while (offset < buffer.length) {
    const marker = buffer[offset++];
    if (marker === 0x3b) return frames > 1;
    if (marker === 0x21) {
      offset += 1;
      if (!skipSubBlocks()) break;
      continue;
    }
    if (marker === 0x2c) {
      frames += 1;
      if (frames > 1) return true;
      if (offset + 9 > buffer.length) break;
      const imagePacked = buffer[offset + 8];
      offset += 9;
      if (imagePacked & 0x80) offset += 3 * (2 ** ((imagePacked & 0x07) + 1));
      offset += 1;
      if (!skipSubBlocks()) break;
      continue;
    }
    break;
  }
  if (frames === 1) return false;
  throw new ToolKnitError('INPUT_INVALID', 'GIF input is damaged or contains no image frame.');
}

async function inspectInputs(values, options) {
  if (!Array.isArray(values) || values.length < 2 || values.length > MAX_FILES) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'input_paths must contain 2 to 100 images.');
  }
  const seen = new Set();
  const inputs = [];
  for (const [index, value] of values.entries()) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
      throw new ToolKnitError('INVALID_ARGUMENT', `input_paths[${index}] must be a non-empty path.`);
    }
    const requested = path.resolve(value.trim());
    const extension = path.extname(requested).slice(1).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new ToolKnitError('INPUT_INVALID', `Unsupported image format: ${requested}`);
    }
    let metadata;
    try { metadata = await lstat(requested); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Image input does not exist: ${requested}`); }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1 || metadata.size > MAX_INPUT_BYTES) {
      throw new ToolKnitError('INPUT_INVALID', `Image input must be a non-empty regular file no larger than 20 MB: ${requested}`);
    }
    const canonical = await realpath(requested);
    const duplicateKey = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (seen.has(duplicateKey)) throw new ToolKnitError('INPUT_INVALID', `Duplicate image input: ${canonical}`);
    seen.add(duplicateKey);
    if (extension === 'gif' && isAnimatedGifBuffer(await readFile(canonical))) {
      throw new ToolKnitError('INPUT_INVALID', `Animated GIF is not supported: ${canonical}`);
    }
    let image;
    try { image = await loadImage(canonical); } catch { throw new ToolKnitError('INPUT_INVALID', `Image cannot be decoded: ${canonical}`); }
    const width = Number(image.width);
    const height = Number(image.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) {
      throw new ToolKnitError('INPUT_INVALID', `Image dimensions exceed the 40 megapixel input limit: ${canonical}`);
    }
    inputs.push({ path: canonical, name: path.basename(canonical), width, height });
    report(options, 5 + ((index + 1) / values.length) * 15, `Inspected image ${index + 1}/${values.length}: ${path.basename(canonical)}`);
  }
  return inputs;
}

async function prepareOutputDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'output_dir must be a non-empty path.');
  const requested = path.resolve(value.trim());
  try { await mkdir(requested, { recursive: true }); } catch { throw new ToolKnitError('OUTPUT_INVALID', `Cannot create output directory: ${requested}`); }
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new ToolKnitError('OUTPUT_INVALID', 'output_dir must be a real directory, not a symbolic link.');
  return realpath(requested);
}

function parseRgba(value, forceOpaque) {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(value);
  if (!match) throw new ToolKnitError('INVALID_ARGUMENT', 'background_rgba must use #RRGGBBAA.');
  const [red, green, blue, alpha] = match.slice(1).map(part => Number.parseInt(part, 16));
  return `rgba(${red},${green},${blue},${forceOpaque ? 1 : alpha / 255})`;
}

async function publishOutput(temporaryPath, outputDirectory, extension, outputName) {
  const stem = outputName || 'stitched_image';
  for (let index = 0; index < 10_000; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = path.join(outputDirectory, `${stem}${suffix}${extension}`);
    try {
      await link(temporaryPath, candidate);
      return candidate;
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Cannot publish stitched image in: ${outputDirectory}`);
    }
  }
  throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not reserve a unique stitched image filename.');
}

export async function stitchImages(args, options = {}) {
  assertObject(args);
  assertOnlyKeys(args, new Set(['input_paths', 'output_dir', 'output_name', 'mode', 'reference', 'spacing_px', 'scale_percent', 'format', 'jpeg_quality', 'background_rgba']));
  report(options, 0, 'Validating image stitch request.');
  const inputs = await inspectInputs(args.input_paths, options);
  let layout;
  try {
    layout = calculateImageStitchLayout(inputs, {
      mode: args.mode ?? 'vertical',
      reference: args.reference ?? 'first',
      spacing_px: args.spacing_px ?? 0,
      scale_percent: args.scale_percent ?? 100,
      format: args.format ?? 'png',
      jpeg_quality: args.jpeg_quality ?? 92,
      background_rgba: args.background_rgba ?? '#FFFFFFFF',
      output_name: args.output_name ?? null
    });
  } catch (error) {
    throw new ToolKnitError('INVALID_ARGUMENT', error?.message || 'Invalid stitch settings.');
  }
  const safePixels = Math.min(160_000_000, Math.floor(freemem() / 12));
  if (layout.pixels > safePixels) {
    throw new ToolKnitError('INPUT_TOO_LARGE', 'The stitched image exceeds currently available memory. Reduce scale or remove images.');
  }
  const outputDirectory = await prepareOutputDirectory(args.output_dir);
  let canvas;
  try { canvas = createCanvas(layout.width, layout.height); } catch { throw new ToolKnitError('INPUT_TOO_LARGE', 'The canvas engine cannot allocate the requested output size. Reduce scale.'); }
  const context = canvas.getContext('2d');
  context.fillStyle = parseRgba(layout.background_rgba, layout.format === 'jpg');
  context.fillRect(0, 0, layout.width, layout.height);
  let cursor = 0;
  for (const [index, item] of layout.items.entries()) {
    let image;
    try { image = await loadImage(item.path); } catch { throw new ToolKnitError('INPUT_INVALID', `Image changed or became unreadable: ${item.path}`); }
    const x = layout.mode === 'vertical' ? 0 : cursor;
    const y = layout.mode === 'vertical' ? cursor : 0;
    context.drawImage(image, x, y, item.target_width, item.target_height);
    cursor += (layout.mode === 'vertical' ? item.target_height : item.target_width) + layout.spacing_px;
    report(options, 20 + ((index + 1) / layout.items.length) * 65, `Stitched image ${index + 1}/${layout.items.length}: ${item.name}`);
  }
  report(options, 88, `Encoding ${layout.format.toUpperCase()} output.`);
  let bytes;
  try {
    bytes = layout.format === 'jpg'
      ? canvas.toBuffer('image/jpeg', { quality: layout.jpeg_quality })
      : canvas.toBuffer('image/png');
  } catch {
    throw new ToolKnitError('PROCESSING_FAILED', 'The image encoder could not create the stitched output.');
  }
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new ToolKnitError('PROCESSING_FAILED', 'The image encoder produced an empty output.');
  const temporaryDirectory = await mkdtemp(path.join(outputDirectory, '.toolknit-stitch-'));
  const temporaryPath = path.join(temporaryDirectory, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    const metadata = await stat(temporaryPath);
    if (!metadata.isFile() || metadata.size !== bytes.length) throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'The temporary stitched image is incomplete.');
    const extension = layout.format === 'png' ? '.png' : '.jpg';
    const outputPath = await publishOutput(temporaryPath, outputDirectory, extension, layout.output_name);
    report(options, 100, 'Published the stitched image.');
    return {
      tool: 'image.stitch',
      input_paths: inputs.map(input => input.path),
      output_path: outputPath,
      output_dir: outputDirectory,
      width: layout.width,
      height: layout.height,
      count: inputs.length,
      format: layout.format,
      bytes: metadata.size,
      settings: {
        mode: layout.mode,
        reference: layout.reference,
        spacing_px: layout.spacing_px,
        scale_percent: layout.scale_percent,
        background_rgba: layout.background_rgba,
        jpeg_quality: layout.jpeg_quality,
        output_name: layout.output_name
      }
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
