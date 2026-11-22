import { removeError } from './core.js';

function walkLzw(bytes, start, end, limit, earlyChange, output) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw removeError('decoded');
  if (earlyChange !== 0 && earlyChange !== 1) throw removeError('filter');
  const lengths = new Uint16Array(4096), first = new Uint8Array(4096);
  const prefixes = output ? new Uint16Array(4096) : null, suffixes = output ? new Uint8Array(4096) : null;
  for (let at = 0; at < 256; at++) { lengths[at] = 1; first[at] = at; }
  let at = start, bits = 0, cached = 0, width = 9, next = 258, previous = -1, size = 0, initialized = false;
  const fail = () => { throw removeError('stream'); };
  while (true) {
    while (bits < width) {
      if (at >= end) fail();
      cached = (cached << 8) | bytes[at++]; bits += 8;
    }
    bits -= width;
    const code = (cached >>> bits) & ((1 << width) - 1);
    if (!initialized && code !== 256) fail();
    if (code === 256) {
      initialized = true; width = 9; next = 258; previous = -1; continue;
    }
    if (code === 257) {
      if ((cached & ((1 << bits) - 1)) !== 0) fail();
      return { end: at, length: size };
    }
    const special = code === next && previous !== -1 && next < 4096;
    if (!(code < 256 || (code >= 258 && code < next) || special)) fail();
    const length = special ? lengths[previous] + 1 : lengths[code];
    const head = special ? first[previous] : first[code];
    if (!length || length > 4096) fail();
    if (size + length > limit) throw removeError('decoded');
    if (output) {
      let cursor = size + length - 1, word = special ? previous : code;
      if (special) output[cursor--] = head;
      while (word >= 258) { output[cursor--] = suffixes[word]; word = prefixes[word]; }
      output[cursor] = word;
    }
    if (previous !== -1 && next < 4096) {
      lengths[next] = lengths[previous] + 1; first[next] = first[previous];
      if (output) { prefixes[next] = previous; suffixes[next] = head; }
      next++;
      if (width < 12 && next + earlyChange === 2 ** width) width++;
    }
    previous = code; size += length;
  }
}

/** Validate dictionary references, EOD, padding and size without allocating output. */
export function scanLzw(bytes, start, end, limit, earlyChange = 1) {
  return walkLzw(bytes, start, end, limit, earlyChange);
}

export function decodeLzw(bytes, limit, earlyChange = 1) {
  const boundary = scanLzw(bytes, 0, bytes.length, limit, earlyChange);
  if (boundary.end !== bytes.length) throw removeError('stream');
  const result = new Uint8Array(boundary.length);
  walkLzw(bytes, 0, bytes.length, limit, earlyChange, result);
  return result;
}

/** Separate LZW code-width settings from image prediction geometry. */
export function inlineLzwSettings(token, filterCount, filterArray = false) {
  const fail = () => { throw removeError('inline'); };
  const isNull = value => value?.type === 'constant' && value.raw === 'null';
  if (!token || isNull(token)) return { earlyChange: 1 };
  let value = token;
  if (token.type === 'array') {
    if (token.children.length !== filterCount || token.children.slice(0, -1).some(item => !isNull(item))) fail();
    value = token.children.at(-1);
  } else if (filterCount !== 1 || filterArray) fail();
  if (isNull(value)) return { earlyChange: 1 };
  if (token.type === 'array' && !filterArray) fail();
  if (value?.type !== 'dict' || value.children.length % 2) fail();
  const seen = new Set(), predictionChildren = [];
  const allowed = new Set(['EarlyChange', 'Predictor', 'Colors', 'BitsPerComponent', 'BPC', 'Columns']);
  let earlyChange = 1;
  for (let at = 0; at < value.children.length; at += 2) {
    const key = value.children[at], setting = value.children[at + 1];
    if (key.type !== 'name' || seen.has(key.name) || !allowed.has(key.name)
      || setting.type !== 'number' || !Number.isInteger(setting.value)) fail();
    seen.add(key.name);
    if (key.name === 'EarlyChange') { if (setting.value !== 0 && setting.value !== 1) fail(); earlyChange = setting.value; }
    else predictionChildren.push(key, setting);
  }
  return { earlyChange, predictionParameters: { type: 'dict', children: predictionChildren } };
}
