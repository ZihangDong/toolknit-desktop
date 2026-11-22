import { removeError } from './core.js';

/** Scan before allocating: literal packets, repeated bytes and mandatory EOD. */
export function scanRunLength(bytes, start, end, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) return { oversized: true };
  let at = start, length = 0;
  while (at < end) {
    const control = bytes[at++];
    if (control === 128) return { end: at, length };
    const literal = control < 128, count = literal ? control + 1 : 257 - control;
    const inputLength = literal ? count : 1;
    if (at + inputLength > end) return null;
    length += count;
    if (length > limit) return { oversized: true };
    at += inputLength;
  }
  return null;
}

export function decodeRunLength(bytes, limit) {
  const boundary = scanRunLength(bytes, 0, bytes.length, limit);
  if (boundary?.oversized) throw removeError('decoded');
  if (!boundary || boundary.end !== bytes.length) throw removeError('stream');
  const decoded = new Uint8Array(boundary.length);
  let at = 0, output = 0;
  while (at < boundary.end - 1) {
    const control = bytes[at++];
    const count = control < 128 ? control + 1 : 257 - control;
    if (control < 128) {
      decoded.set(bytes.subarray(at, at + count), output); at += count;
    } else decoded.fill(bytes[at++], output, output + count);
    output += count;
  }
  return decoded;
}
