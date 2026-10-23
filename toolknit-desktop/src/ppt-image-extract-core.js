import JSZip from 'jszip';
import { readRasterDimensions } from './core/image-dimensions.js';

export const PPT_IMAGE_EXTRACT_LIMITS = Object.freeze({
  maxInputBytes: 200 * 1024 * 1024,
  maxSlides: 500,
  maxMediaFiles: 2000,
  maxExportItems: 1000
});

export const PPT_IMAGE_EXTENSIONS = Object.freeze([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'emf', 'wmf', 'tif', 'tiff'
]);

const IMAGE_EXTENSION_SET = new Set(PPT_IMAGE_EXTENSIONS);
const IMAGE_MIME_TYPES = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  emf: 'image/emf',
  wmf: 'image/wmf',
  tif: 'image/tiff',
  tiff: 'image/tiff'
});

const XML_TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

export class PptImageExtractError extends Error {
  constructor(code, message) {
    super(`ppt-image-extract:${code}:${message}`);
    this.name = 'PptImageExtractError';
    this.code = code;
    this.userMessage = message;
  }
}

function fail(code, message) {
  throw new PptImageExtractError(code, message);
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  fail('invalid_request', 'PPTX bytes must be a Uint8Array or ArrayBuffer.');
}

function xmlDecode(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function extractXmlAttributes(source) {
  const attributes = {};
  for (const match of String(source || '').matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/gs)) {
    attributes[match[1]] = xmlDecode(match[3]);
  }
  return attributes;
}

function zipPathExists(zip, partPath) {
  return Boolean(zip.file(partPath));
}

function normalizeZipPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  const clean = normalized.split('/').filter(Boolean).join('/');
  if (!clean || clean.includes('\0')) return null;
  const posix = clean.replaceAll(/\/+/g, '/');
  if (posix.split('/').includes('..')) return null;
  return posix;
}

function resolveRelationshipTarget(baseDirectory, target) {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const normalizedTarget = String(target).replaceAll('\\', '/');
  const joined = normalizedTarget.startsWith('/')
    ? normalizedTarget.slice(1)
    : pathPosixNormalize(`${baseDirectory}/${normalizedTarget}`);
  return normalizeZipPath(joined);
}

function pathPosixNormalize(value) {
  const parts = [];
  for (const part of String(value || '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function directoryName(partPath) {
  const index = partPath.lastIndexOf('/');
  return index === -1 ? '' : partPath.slice(0, index);
}

function relsPathForPart(partPath) {
  const directory = directoryName(partPath);
  const fileName = partPath.slice(directory.length ? directory.length + 1 : 0);
  return `${directory}/_rels/${fileName}.rels`;
}

function extensionFromPath(partPath) {
  const match = /\.([A-Za-z0-9]+)$/.exec(partPath);
  return match ? match[1].toLowerCase() : '';
}

function normalizeImageExtension(extension) {
  const value = String(extension || '').toLowerCase().replace(/^\./, '');
  return value === 'jpeg' ? 'jpg' : value;
}

function padNumber(value, width = 2) {
  return String(value).padStart(width, '0');
}

export function sanitizePptImageBaseName(value) {
  const pathBaseName = String(value || 'presentation').split(/[\\/]/).pop() || 'presentation';
  const base = pathBaseName
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80);
  if (!base || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) return 'presentation';
  return base;
}

function suggestedFileName(item, extension) {
  const normalizedExtension = normalizeImageExtension(extension);
  if (item.slide_number) {
    return `slide_${padNumber(item.slide_number)}_image_${String(item.index).padStart(3, '0')}.${normalizedExtension}`;
  }
  return `media_image_${String(item.index).padStart(3, '0')}.${normalizedExtension}`;
}

function parseRelationships(xml, baseDirectory) {
  const relationships = new Map();
  for (const match of String(xml || '').matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const attributes = extractXmlAttributes(match[1]);
    if (!attributes.Id || !attributes.Target) continue;
    if (String(attributes.TargetMode || '').toLowerCase() === 'external') continue;
    const targetPath = resolveRelationshipTarget(baseDirectory, attributes.Target);
    if (!targetPath) continue;
    relationships.set(attributes.Id, {
      id: attributes.Id,
      type: attributes.Type || '',
      target: attributes.Target,
      targetPath
    });
  }
  return relationships;
}

function extractEmbedOrder(slideXml) {
  const order = [];
  for (const match of String(slideXml || '').matchAll(/\b(?:r:embed|r:link|embed|link)\s*=\s*(["'])(.*?)\1/gi)) {
    const id = xmlDecode(match[2]);
    if (id && !order.includes(id)) order.push(id);
  }
  return order;
}

async function readZipText(zip, partPath) {
  const file = zip.file(partPath);
  if (!file) return '';
  return file.async('string');
}

async function readRequiredZipText(zip, partPath) {
  const text = await readZipText(zip, partPath);
  if (!text) fail('invalid_pptx', `PPTX is missing ${partPath}.`);
  return text;
}

function findSlideParts(zip) {
  return Object.keys(zip.files)
    .map(normalizeZipPath)
    .filter(Boolean)
    .filter(partPath => /^ppt\/slides\/slide\d+\.xml$/i.test(partPath))
    .sort((left, right) => {
      const leftNumber = Number(/slide(\d+)\.xml$/i.exec(left)?.[1] || 0);
      const rightNumber = Number(/slide(\d+)\.xml$/i.exec(right)?.[1] || 0);
      return leftNumber - rightNumber;
    });
}

async function orderedSlides(zip) {
  const slideParts = findSlideParts(zip);
  if (slideParts.length < 1) fail('invalid_pptx', 'PPTX does not contain any slides.');
  if (slideParts.length > PPT_IMAGE_EXTRACT_LIMITS.maxSlides) {
    fail('too_many_slides', `PPTX contains more than ${PPT_IMAGE_EXTRACT_LIMITS.maxSlides} slides.`);
  }

  const presentationXml = await readZipText(zip, 'ppt/presentation.xml');
  const relsXml = await readZipText(zip, 'ppt/_rels/presentation.xml.rels');
  const presentationRels = parseRelationships(relsXml, 'ppt');
  const ordered = [];
  for (const match of String(presentationXml || '').matchAll(/<p:sldId\b([^>]*)\/?>/gi)) {
    const attributes = extractXmlAttributes(match[1]);
    const relationId = attributes['r:id'] || attributes.id;
    const relation = relationId ? presentationRels.get(relationId) : null;
    if (relation?.targetPath && slideParts.includes(relation.targetPath) && !ordered.includes(relation.targetPath)) {
      ordered.push(relation.targetPath);
    }
  }
  const finalOrder = ordered.length ? ordered : slideParts;
  return finalOrder.map((partPath, index) => ({
    partPath,
    slide_number: index + 1,
    source_slide_number: Number(/slide(\d+)\.xml$/i.exec(partPath)?.[1] || index + 1)
  }));
}

function isPptContentTypeValid(contentTypesXml) {
  return /presentationml\.presentation\.main\+xml/i.test(contentTypesXml)
    || /PartName=(["'])\/ppt\/presentation\.xml\1/i.test(contentTypesXml);
}

export function assertPptxBytes(bytes, sourceName = 'presentation.pptx') {
  const data = toUint8Array(bytes);
  if (!String(sourceName || '').toLowerCase().endsWith('.pptx')) {
    fail('invalid_extension', 'Only .pptx files are supported in the first PPT image extraction stage.');
  }
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4B) {
    fail('invalid_pptx', 'PPTX must be a valid ZIP-based PowerPoint file.');
  }
  if (data.byteLength > PPT_IMAGE_EXTRACT_LIMITS.maxInputBytes) {
    fail('input_too_large', `PPTX files for image extraction must be ${PPT_IMAGE_EXTRACT_LIMITS.maxInputBytes / 1024 / 1024}MB or smaller.`);
  }
  return data;
}


function readSvgDimensions(bytes) {
  const text = XML_TEXT_DECODER.decode(bytes.slice(0, Math.min(bytes.length, 8192)));
  if (!/<svg\b/i.test(text)) return null;
  const widthMatch = /\bwidth\s*=\s*(["'])([\d.]+)(?:px)?\1/i.exec(text);
  const heightMatch = /\bheight\s*=\s*(["'])([\d.]+)(?:px)?\1/i.exec(text);
  if (widthMatch && heightMatch) {
    const width = Math.round(Number(widthMatch[2]));
    const height = Math.round(Number(heightMatch[2]));
    if (width > 0 && height > 0) return { width, height };
  }
  const viewBoxMatch = /\bviewBox\s*=\s*(["'])\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*\1/i.exec(text);
  if (viewBoxMatch) {
    const width = Math.round(Number(viewBoxMatch[2]));
    const height = Math.round(Number(viewBoxMatch[3]));
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

export function readPptImageDimensions(bytes, extension) {
  const data = toUint8Array(bytes);
  const ext = normalizeImageExtension(extensionFromPath(`file.${extension || ''}`));
  const dimensions = ext === 'svg' ? readSvgDimensions(data) : readRasterDimensions(data, ext);
  if (!dimensions || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) {
    return { width: null, height: null };
  }
  return { width: dimensions.width, height: dimensions.height };
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toUint8Array(bytes));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function imageDescriptor({ zip, mediaPath, index, slideNumber, source, relationshipId, seenHashes }) {
  const extension = extensionFromPath(mediaPath);
  const normalizedExtension = normalizeImageExtension(extension);
  const file = zip.file(mediaPath);
  if (!file || !IMAGE_EXTENSION_SET.has(extension)) return null;
  const bytes = await file.async('uint8array');
  const hash = await sha256Hex(bytes);
  const duplicateOf = seenHashes.get(hash) || null;
  if (!duplicateOf) seenHashes.set(hash, String(index).padStart(3, '0'));
  const dimensions = readPptImageDimensions(bytes, extension);
  const item = {
    index,
    id: String(index).padStart(3, '0'),
    slide_number: slideNumber,
    source,
    relationship_id: relationshipId || null,
    media_path: mediaPath,
    original_name: mediaPath.split('/').pop(),
    extension: normalizedExtension,
    mime_type: IMAGE_MIME_TYPES[extension] || IMAGE_MIME_TYPES[normalizedExtension] || 'application/octet-stream',
    width: dimensions.width,
    height: dimensions.height,
    bytes: bytes.byteLength,
    sha256: hash,
    duplicate_of: duplicateOf,
    is_duplicate: Boolean(duplicateOf),
    is_small_icon: Boolean(dimensions.width && dimensions.height && dimensions.width <= 96 && dimensions.height <= 96),
    suggested_file_name: null
  };
  item.suggested_file_name = suggestedFileName(item, normalizedExtension);
  return item;
}

export async function analyzePptxImages(bytes, options = {}) {
  const data = assertPptxBytes(bytes, options.sourceName || 'presentation.pptx');
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    fail('invalid_pptx', 'PPTX could not be opened as a ZIP package.');
  }
  const contentTypes = await readRequiredZipText(zip, '[Content_Types].xml');
  await readRequiredZipText(zip, 'ppt/presentation.xml');
  if (!isPptContentTypeValid(contentTypes)) {
    fail('invalid_pptx', 'PPTX does not look like a PowerPoint presentation package.');
  }

  const mediaParts = Object.keys(zip.files)
    .map(normalizeZipPath)
    .filter(Boolean)
    .filter(partPath => /^ppt\/media\/[^/]+\.[A-Za-z0-9]+$/i.test(partPath))
    .filter(partPath => IMAGE_EXTENSION_SET.has(extensionFromPath(partPath)));
  if (mediaParts.length > PPT_IMAGE_EXTRACT_LIMITS.maxMediaFiles) {
    fail('too_many_media', `PPTX contains more than ${PPT_IMAGE_EXTRACT_LIMITS.maxMediaFiles} media files.`);
  }

  const slides = await orderedSlides(zip);
  const seenMediaUsages = new Set();
  const seenHashes = new Map();
  const images = [];
  const missing = [];
  for (const slide of slides) {
    const slideXml = await readZipText(zip, slide.partPath);
    const rels = parseRelationships(await readZipText(zip, relsPathForPart(slide.partPath)), directoryName(slide.partPath));
    const embedOrder = extractEmbedOrder(slideXml);
    const imageRelations = [...rels.values()].filter(relation => /\/image$/i.test(relation.type) || /^ppt\/media\//i.test(relation.targetPath));
    const orderedRelationIds = [
      ...embedOrder.filter(id => imageRelations.some(relation => relation.id === id)),
      ...imageRelations.map(relation => relation.id).filter(id => !embedOrder.includes(id))
    ];
    for (const relationId of orderedRelationIds) {
      const relation = rels.get(relationId);
      if (!relation) continue;
      const mediaPath = relation.targetPath;
      if (!zipPathExists(zip, mediaPath)) {
        missing.push({ slide_number: slide.slide_number, relationship_id: relationId, media_path: mediaPath });
        continue;
      }
      const usageKey = `${slide.partPath}|${relationId}|${mediaPath}`;
      if (seenMediaUsages.has(usageKey)) continue;
      seenMediaUsages.add(usageKey);
      const item = await imageDescriptor({
        zip,
        mediaPath,
        index: images.length + 1,
        slideNumber: slide.slide_number,
        source: 'slide',
        relationshipId: relationId,
        seenHashes
      });
      if (item) images.push(item);
    }
  }

  const referencedMedia = new Set(images.map(item => item.media_path));
  for (const mediaPath of mediaParts.sort()) {
    if (referencedMedia.has(mediaPath)) continue;
    const item = await imageDescriptor({
      zip,
      mediaPath,
      index: images.length + 1,
      slideNumber: null,
      source: 'media',
      relationshipId: null,
      seenHashes
    });
    if (item) images.push(item);
  }

  return {
    source_name: options.sourceName || 'presentation.pptx',
    slide_count: slides.length,
    media_count: mediaParts.length,
    image_count: images.length,
    duplicate_count: images.filter(item => item.is_duplicate).length,
    missing_count: missing.length,
    images,
    missing
  };
}

function normalizePositiveIntegerSelection(value, maxValue, label) {
  if (value === undefined || value === null || value === '') return null;
  const values = [];
  const push = item => {
    if (!Number.isSafeInteger(item) || item < 1 || item > maxValue) {
      fail('invalid_selection', `${label} contains an out-of-range number: ${item}.`);
    }
    values.push(item);
  };
  if (typeof value === 'string') {
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (end < start) fail('invalid_selection', `${label} ranges must be ascending.`);
        for (let item = start; item <= end; item++) push(item);
      } else if (/^\d+$/.test(trimmed)) {
        push(Number(trimmed));
      } else {
        fail('invalid_selection', `${label} must use numbers and ranges such as 1,3-5.`);
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) push(Number(item));
  } else {
    fail('invalid_selection', `${label} must be an array or a range string.`);
  }
  const unique = [...new Set(values)].sort((left, right) => left - right);
  if (unique.length !== values.length || unique.length < 1) fail('invalid_selection', `${label} must contain unique numbers.`);
  return unique;
}

export function normalizePptImageSelection(value, imageCount) {
  return normalizePositiveIntegerSelection(value, imageCount, 'images');
}

export function normalizePptPageSelection(value, slideCount) {
  return normalizePositiveIntegerSelection(value, slideCount, 'pages');
}

export function planPptImageExport(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.images)) {
    fail('invalid_request', 'PPT image manifest is required.');
  }
  if (manifest.images.length > PPT_IMAGE_EXTRACT_LIMITS.maxExportItems) {
    fail('too_many_images', `PPT image extraction can export at most ${PPT_IMAGE_EXTRACT_LIMITS.maxExportItems} images at once.`);
  }
  const imageSelection = normalizePptImageSelection(options.images, manifest.image_count);
  const pageSelection = normalizePptPageSelection(options.pages, manifest.slide_count);
  const imageSet = imageSelection ? new Set(imageSelection) : null;
  const pageSet = pageSelection ? new Set(pageSelection) : null;
  const selected = manifest.images.filter(item => {
    if (imageSet && !imageSet.has(item.index)) return false;
    if (pageSet && !pageSet.has(item.slide_number)) return false;
    if (options.skip_duplicates === true && item.is_duplicate) return false;
    return true;
  });
  if (selected.length < 1) {
    fail('invalid_selection', 'No PPT images matched the requested selection.');
  }
  return {
    selected_images: selected,
    selected_count: selected.length,
    selected_bytes: selected.reduce((sum, item) => sum + item.bytes, 0),
    skipped_duplicates: manifest.images.filter(item => item.is_duplicate && !selected.includes(item)).length,
    pages: pageSelection,
    images: imageSelection,
    skip_duplicates: options.skip_duplicates === true
  };
}

export function createPptImageManifestMarkdown(result) {
  const lines = [
    `# PPT 图片提取清单`,
    '',
    `- 源文件：${result.input?.path || result.input?.name || result.source_name || 'presentation.pptx'}`,
    `- 幻灯片数量：${result.slide_count}`,
    `- 图片素材数量：${result.image_count}`,
    `- 重复素材数量：${result.duplicate_count}`,
    ''
  ];
  if (result.outputs?.length) {
    lines.push('## 已导出文件', '');
    lines.push('| 编号 | 页码 | 格式 | 尺寸 | 大小 | 文件 |');
    lines.push('| --- | --- | --- | --- | ---: | --- |');
    for (const output of result.outputs) {
      const item = output.item || output;
      const size = item.bytes || output.bytes || 0;
      const dimensions = item.width && item.height ? `${item.width} × ${item.height}` : '未知';
      lines.push(`| ${item.id || String(item.index).padStart(3, '0')} | ${item.slide_number || '未定位'} | ${(item.extension || output.extension || '').toUpperCase()} | ${dimensions} | ${size} | ${output.relative_path || item.suggested_file_name || ''} |`);
    }
  } else {
    lines.push('## 图片素材', '');
    lines.push('| 编号 | 页码 | 格式 | 尺寸 | 大小 | 重复 | 原始路径 |');
    lines.push('| --- | --- | --- | --- | ---: | --- | --- |');
    for (const item of result.images || []) {
      const dimensions = item.width && item.height ? `${item.width} × ${item.height}` : '未知';
      lines.push(`| ${item.id} | ${item.slide_number || '未定位'} | ${item.extension.toUpperCase()} | ${dimensions} | ${item.bytes} | ${item.duplicate_of || '否'} | ${item.media_path} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}
