export const COLOR_EXTRACTOR_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxPixels: 40_000_000
});

const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function isSupportedColorExtractorFile(file) {
  if (!file) return false;
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (SUPPORTED_TYPES.has(type)) return true;
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  return /\.(png|jpe?g|webp)$/.test(name);
}

export function assertColorExtractorFile(file, size = file?.size) {
  if (!isSupportedColorExtractorFile(file)) throw new TypeError('Only PNG, JPEG, and WebP images are supported.');
  if (size === undefined || size === null) return;
  if (!Number.isSafeInteger(Number(size)) || Number(size) < 0 || Number(size) > COLOR_EXTRACTOR_LIMITS.maxBytes) {
    throw new RangeError('Image file exceeds the supported size limit.');
  }
}

export function assertColorExtractorDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Image dimensions are invalid.');
  }
  if (width * height > COLOR_EXTRACTOR_LIMITS.maxPixels) {
    throw new RangeError('Image dimensions exceed the supported pixel limit.');
  }
}

function readUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segmentLength >= 7) {
      return {
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        height: (bytes[offset + 3] << 8) | bytes[offset + 4]
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes) {
  if (bytes.length < 30
    || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return null;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkLength = bytes[offset + 4]
      | (bytes[offset + 5] << 8)
      | (bytes[offset + 6] << 16)
      | (bytes[offset + 7] << 24);
    const dataOffset = offset + 8;
    if (chunkLength < 0 || dataOffset + chunkLength > bytes.length) return null;

    if (chunkType === 'VP8X' && chunkLength >= 10) {
      return {
        width: readUint24LE(bytes, dataOffset + 4) + 1,
        height: readUint24LE(bytes, dataOffset + 7) + 1
      };
    }
    if (chunkType === 'VP8 ' && chunkLength >= 10
      && bytes[dataOffset + 3] === 0x9d
      && bytes[dataOffset + 4] === 0x01
      && bytes[dataOffset + 5] === 0x2a) {
      return {
        width: ((bytes[dataOffset + 7] & 0x3f) << 8) | bytes[dataOffset + 6],
        height: ((bytes[dataOffset + 9] & 0x3f) << 8) | bytes[dataOffset + 8]
      };
    }
    if (chunkType === 'VP8L' && chunkLength >= 5 && bytes[dataOffset] === 0x2f) {
      return {
        width: 1 + (((bytes[dataOffset + 2] & 0x3f) << 8) | bytes[dataOffset + 1]),
        height: 1 + (((bytes[dataOffset + 4] & 0x0f) << 10)
          | (bytes[dataOffset + 3] << 2)
          | ((bytes[dataOffset + 2] & 0xc0) >> 6))
      };
    }
    offset = dataOffset + chunkLength + (chunkLength % 2);
  }
  return null;
}

export function readColorExtractorImageDimensions(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return readJpegDimensions(bytes) || readWebpDimensions(bytes);
}

export function assertColorExtractorImageBytes(data) {
  const dimensions = readColorExtractorImageDimensions(data);
  if (!dimensions) throw new TypeError('Image data is unsupported or malformed.');
  assertColorExtractorDimensions(dimensions.width, dimensions.height);
  return dimensions;
}
