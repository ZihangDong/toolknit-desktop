export const asciiSpace = character =>
  character !== undefined && ' \t\r\n'.includes(character);

export function scanAsciiFilter(kind, text, start, limit, maxBytes) {
  return kind === 'ASCIIHexDecode'
    ? scanHex(text, start, limit, maxBytes)
    : scan85(text, start, limit, maxBytes);
}

function scanHex(text, start, limit, maxBytes) {
  let digits = 0;
  for (let at = start; at < limit; at++) {
    const char = text[at];
    if (char === '>') return { end: at + 1, length: Math.ceil(digits / 2) };
    if (asciiSpace(char)) continue;
    if (!/^[\da-f]$/i.test(char)) return null;
    if (++digits > maxBytes * 2) return { oversized: true };
  }
  return null;
}

function scan85(text, start, limit, maxBytes) {
  let decoded = 0, value = 0, digits = 0;
  for (let at = start; at < limit; at++) {
    const char = text[at];
    if (asciiSpace(char)) continue;
    if (char === '~') {
      if (at + 1 >= limit || text[at + 1] !== '>' || digits === 1) return null;
      if (digits) {
        const scale = 85 ** (5 - digits);
        if ((value + 1) * scale - 1 > 0xffffffff) return null;
        decoded += digits - 1;
      }
      return { end: at + 2, length: decoded };
    }
    if (char === 'z') {
      if (digits) return null;
      decoded += 4;
    } else {
      const digit = char.charCodeAt(0) - 33;
      if (digit < 0 || digit > 84) return null;
      value = value * 85 + digit;
      if (++digits === 5) {
        if (value > 0xffffffff) return null;
        decoded += 4;
        value = 0;
        digits = 0;
      }
    }
    if (decoded + Math.max(0, digits - 1) > maxBytes) return { oversized: true };
  }
  return null;
}
