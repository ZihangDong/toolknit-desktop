// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
const family = value => typeof value === 'string' && value.length <= 160 ? value.replace(/^[A-Z]{6}\+/, '') : '';
const texFamilies = /^(CMR|CMB|CMBX|CMMI|CMMIB|CMTI|CMBXTI|CMSY|CMBSY|MSBM|CMEX)([1-9]\d?)$/;

export function trustedTexFamily(sourceName, embeddedName) {
  const name = family(sourceName);
  return name === family(embeddedName) ? name.match(texFamilies)?.[1] || null : null;
}

/** Font names supplement embedded metadata only for known TeX encodings. */
export function sourceFontTraits(source, text, embedded = null) {
  const name = family(source.name), tex = name.match(texFamilies);
  const traits = { bold: Boolean(embedded?.bold), italic: Boolean(embedded?.italic) };
  if (!tex) return traits;
  const kind = trustedTexFamily(source.name, embedded?.name);
  if (!kind) return { ...traits, mathStyleUncertain: true };
  traits.bold ||= ['CMB', 'CMBX', 'CMMIB', 'CMBXTI', 'CMBSY'].includes(kind);
  if (kind === 'CMEX') { traits.symbolFace = true; traits.italic = false;
  } else if (['CMSY', 'CMBSY', 'MSBM'].includes(kind)) {
    traits.symbolFace = true; traits.italic = false;
    // CMSY capitals are calligraphic; MSBM capitals are double-struck. Their
    // operators are not italic merely because the descriptor has an angle.
    if (/[a-z]/.test(text)) traits.mathStyleUncertain = true;
    else if (/[A-Z]/.test(text)) traits.alphabet = kind === 'MSBM' ? 'doubleStruck' : 'script';
  } else traits.italic ||= ['CMMI', 'CMMIB', 'CMTI', 'CMBXTI'].includes(kind);
  return traits;
}

const scriptCapitals = [0x1d49c, 0x212c, 0x1d49e, 0x1d49f, 0x2130, 0x2131, 0x1d4a2, 0x210b, 0x2110,
  0x1d4a5, 0x1d4a6, 0x2112, 0x2133, 0x1d4a9, 0x1d4aa, 0x1d4ab, 0x1d4ac, 0x211b, 0x1d4ae, 0x1d4af,
  0x1d4b0, 0x1d4b1, 0x1d4b2, 0x1d4b3, 0x1d4b4, 0x1d4b5];
const doubleCapitals = [0x1d538, 0x1d539, 0x2102, 0x1d53b, 0x1d53c, 0x1d53d, 0x1d53e, 0x210d, 0x1d540,
  0x1d541, 0x1d542, 0x1d543, 0x1d544, 0x2115, 0x1d546, 0x2119, 0x211a, 0x211d, 0x1d54a, 0x1d54b,
  0x1d54c, 0x1d54d, 0x1d54e, 0x1d54f, 0x1d550, 0x2124];

/** The Unicode glyph used for measuring OMML's source-bound script alphabet. */
export function mathDisplayText(text, alphabet, bold = false) {
  if (!alphabet) return text;
  if (!['script', 'doubleStruck'].includes(alphabet) || alphabet === 'doubleStruck' && bold) return null;
  return [...text].map(character => {
    if (!/[A-Z]/.test(character)) return character;
    const index = character.charCodeAt(0) - 65;
    return String.fromCodePoint(alphabet === 'doubleStruck' ? doubleCapitals[index] : bold ? 0x1d4d0 + index : scriptCapitals[index]);
  }).join('');
}
