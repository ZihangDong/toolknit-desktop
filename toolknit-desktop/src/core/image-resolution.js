const validDpi = value => Number.isFinite(value) && value >= 36 && value <= 2400 ? value : null;
const pair = (x, y) => {
  x = validDpi(x); y = validDpi(y);
  return x || y ? { dpiX: x || y, dpiY: y || x } : {};
};

function exif(bytes) {
  if (bytes.length < 8) return {};
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77)) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => offset >= 0 && offset + 2 <= bytes.length ? view.getUint16(offset, little) : null;
  const u32 = offset => offset >= 0 && offset + 4 <= bytes.length ? view.getUint32(offset, little) : null;
  if (u16(2) !== 42) return {};
  const directory = u32(4), count = directory === null ? null : u16(directory);
  if (count === null || count > 512 || directory + 2 + count * 12 > bytes.length) return {};
  let x, y, unit = 2, orientation = 1;
  for (let i = 0; i < count; i++) {
    const entry = directory + 2 + i * 12, tag = u16(entry), type = u16(entry + 2);
    if (u32(entry + 4) !== 1) continue;
    if (type === 3 && tag === 0x112) orientation = u16(entry + 8);
    if (type === 3 && tag === 0x128) unit = u16(entry + 8);
    if (type !== 5 || ![0x11a, 0x11b].includes(tag)) continue;
    const offset = u32(entry + 8), numerator = offset === null ? null : u32(offset), denominator = offset === null ? null : u32(offset + 4);
    if (numerator === null || !denominator) continue;
    if (tag === 0x11a) x = numerator / denominator; else y = numerator / denominator;
  }
  return { ...(unit === 2 || unit === 3 ? pair(x * (unit === 3 ? 2.54 : 1), y * (unit === 3 ? 2.54 : 1)) : {}),
    orientation: orientation >= 1 && orientation <= 8 ? orientation : 1 };
}

/** Read bounded, absolute resolution metadata; never execute or decode payloads. */
export function readImageResolution(bytes, extension) {
  if (!(bytes instanceof Uint8Array)) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ext = String(extension).toLowerCase();
  const tag = (offset, text) => offset + text.length <= bytes.length && [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  let density = {}, metadata = {};
  if (ext === 'png' && bytes.length >= 8 && bytes[0] === 137 && tag(1, 'PNG\r\n\x1a\n')) {
    for (let offset = 8, chunks = 0; offset + 12 <= bytes.length && chunks < 4096; chunks++) {
      const length = view.getUint32(offset), end = offset + length + 12;
      if (end > bytes.length) break;
      if (tag(offset + 4, 'pHYs') && length === 9 && bytes[offset + 16] === 1)
        density = pair(view.getUint32(offset + 8) * .0254, view.getUint32(offset + 12) * .0254);
      if (tag(offset + 4, 'eXIf')) metadata = exif(bytes.subarray(offset + 8, end - 4));
      if (tag(offset + 4, 'IDAT')) break;
      offset = end;
    }
  } else if (['jpg', 'jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    for (let segments = 0; offset + 4 <= bytes.length && segments < 4096; segments++) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset), end = offset + length, start = offset + 2;
      if (length < 2 || end > bytes.length) break;
      if (marker === 0xe0 && length >= 16 && tag(start, 'JFIF\0')) {
        const unit = bytes[start + 7];
        if (unit === 1 || unit === 2) density = pair(view.getUint16(start + 8) * (unit === 2 ? 2.54 : 1), view.getUint16(start + 10) * (unit === 2 ? 2.54 : 1));
      }
      if (marker === 0xe1 && length >= 8 && tag(start, 'Exif\0\0')) metadata = exif(bytes.subarray(start + 6, end));
      offset = end;
    }
  } else if (ext === 'webp' && bytes.length >= 12 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
    for (let offset = 12, chunks = 0; offset + 8 <= bytes.length && chunks < 4096; chunks++) {
      const length = view.getUint32(offset + 4, true), end = offset + 8 + length;
      if (end > bytes.length) break;
      if (tag(offset, 'EXIF')) {
        const start = offset + 8;
        metadata = exif(bytes.subarray(start + (length >= 6 && tag(start, 'Exif\0\0') ? 6 : 0), end)); break;
      }
      offset = end + length % 2;
    }
  } else if (ext === 'bmp' && bytes.length >= 54 && tag(0, 'BM') && view.getUint32(14, true) >= 40) {
    density = pair(view.getInt32(38, true) * .0254, view.getInt32(42, true) * .0254);
  }
  const value = ext === 'png' ? { ...metadata, ...density } : { ...density, ...metadata };
  if (value.orientation >= 5 && value.orientation <= 8) [value.dpiX, value.dpiY] = [value.dpiY, value.dpiX];
  return value;
}
