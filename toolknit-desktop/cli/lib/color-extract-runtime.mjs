import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { COLOR_EXTRACTOR_LIMITS, assertColorExtractorImageBytes, readColorExtractorImageDimensions } from './core/color-extractor-core.js';
import { ToolKnitError } from './errors.mjs';

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function report(options, value, message) { try { options.reportProgress?.(value, message); } catch {} }
function rgbToHex(r, g, b) { return `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`; }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b); const min = Math.min(r, g, b); const lightness = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(lightness * 100)];
  const delta = max - min; const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [Math.round(hue / 6 * 360), Math.round(saturation * 100), Math.round(lightness * 100)];
}

function paletteFromRgba(data, count) {
  const pixels = [];
  for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] >= 128) pixels.push([data[offset], data[offset + 1], data[offset + 2]]);
  if (!pixels.length) throw new ToolKnitError('PROCESSING_FAILED', 'The image does not contain visible pixels.');
  const colorCount = Math.max(2, Math.min(9, count ?? 9));
  const centroids = [];
  const step = Math.max(1, Math.floor(pixels.length / colorCount));
  for (let index = 0; index < colorCount && index * step < pixels.length; index++) centroids.push([...pixels[index * step]]);
  let sums = [];
  for (let iteration = 0; iteration < 12; iteration++) {
    sums = centroids.map(() => [0, 0, 0, 0]);
    for (const pixel of pixels) {
      let best = 0; let distance = Infinity;
      for (let index = 0; index < centroids.length; index++) { const c = centroids[index]; const d = (pixel[0] - c[0]) ** 2 + (pixel[1] - c[1]) ** 2 + (pixel[2] - c[2]) ** 2; if (d < distance) { distance = d; best = index; } }
      sums[best][0] += pixel[0]; sums[best][1] += pixel[1]; sums[best][2] += pixel[2]; sums[best][3] += 1;
    }
    let changed = false;
    for (let index = 0; index < centroids.length; index++) if (sums[index][3]) { const next = sums[index].slice(0, 3).map(value => value / sums[index][3]); if (next.some((value, channel) => Math.abs(value - centroids[index][channel]) > 1)) changed = true; centroids[index] = next; }
    if (!changed) break;
  }
  return centroids.map((rgb, index) => { const value = rgb.map(Math.round); const hsl = rgbToHsl(...value); const pixelsInCluster = sums[index]?.[3] ?? 0; return { hex: rgbToHex(...value), rgb: { r: value[0], g: value[1], b: value[2] }, hsl: { h: hsl[0], s: hsl[1], l: hsl[2] }, pixels: pixelsInCluster, percentage: Number((pixelsInCluster / pixels.length * 100).toFixed(2)) }; }).sort((left, right) => right.pixels - left.pixels);
}

export async function extractColorPalette(args, options = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  if (Object.keys(args).some(key => !['input_path', 'count'].includes(key))) throw new ToolKnitError('INVALID_ARGUMENT', 'Unknown argument.');
  if (typeof args.input_path !== 'string' || !args.input_path.trim() || args.input_path.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'input_path must be a non-empty path string.');
  const requested = path.resolve(args.input_path.trim());
  report(options, 0, 'Validating image input.');
  let meta; try { meta = await lstat(requested); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Image input does not exist: ${requested}`); }
  if (meta.isSymbolicLink() || !meta.isFile() || meta.size < 1 || !EXTENSIONS.has(path.extname(requested).toLowerCase())) throw new ToolKnitError('INPUT_INVALID', `Image input must be a supported regular PNG, JPEG, or WebP file: ${requested}`);
  if (meta.size > COLOR_EXTRACTOR_LIMITS.maxBytes) throw new ToolKnitError('INPUT_TOO_LARGE', 'Images for palette extraction must be 20MB or smaller.');
  const count = args.count === undefined ? 5 : Number(args.count);
  if (!Number.isInteger(count) || count < 2 || count > 9) throw new ToolKnitError('INVALID_ARGUMENT', 'count must be an integer from 2 to 9.');
  const bytes = await readFile(requested); let dimensions;
  try { dimensions = assertColorExtractorImageBytes(bytes); } catch (error) { throw new ToolKnitError(error instanceof RangeError ? 'INPUT_TOO_LARGE' : 'INPUT_INVALID', error.message); }
  report(options, 20, 'Decoding image pixels.');
  let image; try { image = await loadImage(bytes); } catch { throw new ToolKnitError('INPUT_INVALID', 'Image data could not be decoded.'); }
  const scale = Math.min(200 / dimensions.width, 200 / dimensions.height, 1); const width = Math.max(1, Math.round(dimensions.width * scale)); const height = Math.max(1, Math.round(dimensions.height * scale));
  const canvas = createCanvas(width, height); const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, width, height);
  report(options, 55, 'Clustering dominant colors.');
  const palette = paletteFromRgba(context.getImageData(0, 0, width, height).data, count);
  report(options, 100, 'Color palette extraction completed.');
  return { tool: 'color.extract', input: { path: await realpath(requested), bytes: bytes.length, width: dimensions.width, height: dimensions.height }, sampled: { width, height, visible_pixels: palette.reduce((sum, color) => sum + color.pixels, 0) }, palette };
}
