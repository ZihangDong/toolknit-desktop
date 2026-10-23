const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });
function readPngDimensions(bytes) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readGifDimensions(bytes) {
  if (bytes.length < 10 || TEXT_DECODER.decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/) === null) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function readBmpDimensions(bytes) {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4D) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
}

function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xD8 || marker === 0xD9) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
      return { width: (bytes[offset + 5] << 8) + bytes[offset + 6], height: (bytes[offset + 3] << 8) + bytes[offset + 4] };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(bytes) {
  if (bytes.length < 30 || TEXT_DECODER.decode(bytes.subarray(0, 4)) !== 'RIFF' || TEXT_DECODER.decode(bytes.subarray(8, 12)) !== 'WEBP') return null;
  const chunk = TEXT_DECODER.decode(bytes.subarray(12, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
    return { width: view.getUint16(26, true) & 0x3FFF, height: view.getUint16(28, true) & 0x3FFF };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2F) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
  }
  return null;
}

export function readRasterDimensions(bytes, extension) {
  const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  if (!data) return null;
  const ext = String(extension).toLowerCase().replace(/^\\./, '');
  const readers = { png: readPngDimensions, jpg: readJpegDimensions, jpeg: readJpegDimensions,
    gif: readGifDimensions, webp: readWebpDimensions, bmp: readBmpDimensions };
  const result = readers[ext]?.(data);
  return result && Number.isInteger(result.width) && Number.isInteger(result.height) && result.width > 0 && result.height > 0 ? result : null;
}
