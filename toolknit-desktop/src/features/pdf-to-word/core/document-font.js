// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { isSourceFontName } from './source-font.js';
import { isOcrFontName, OCR_FONT_LIMITS } from './ocr-font-ttf.js';

export const isDocumentFontName = name => isSourceFontName(name) || isOcrFontName(name);
export const documentFontAssetId = name => isDocumentFontName(name) ? 'font:' + name : null;
export const fontProvenanceBytes = asset => asset?.origin === 'generated-ocr-outline'
  ? 1024 + (asset.ocrProvenance?.glyphs?.length || 0) * 512 : 0;
const digest = text => typeof text === 'string' && /^[0-9a-f]{64}$/.test(text);
const scalar = text => typeof text === 'string' && text.length === 1 && Boolean(text.trim()) && text.charCodeAt(0) >= 32
  && !/[\x7f-\x9f\ud800-\uf8ff\ufffe\uffff]/u.test(text);

/** Structural provenance gate for newly generated OCR outlines. This never
 * interprets or changes permission flags of an original PDF font program.
 * The generating adapter separately proves pixels, spelling and ownership.
 */
export function validOcrFontProvenance(asset) {
  if (!asset || asset.origin !== 'generated-ocr-outline' || !isOcrFontName(asset.name)
    || asset.id !== documentFontAssetId(asset.name) || asset.fsType !== 0 || asset.italic !== false
    || typeof asset.bold !== 'boolean' || asset.weight !== (asset.bold ? 700 : 400)
    || !(asset.bytes instanceof Uint8Array) || asset.bytes.length > OCR_FONT_LIMITS.bytes
    || typeof asset.glyphs !== 'string' || !asset.glyphs.length || asset.glyphs.length > OCR_FONT_LIMITS.glyphs
    || !digest(asset.fingerprint)) return false;
  const proof = asset.ocrProvenance;
  if (!proof || proof.version !== 1 || !Number.isInteger(proof.page) || proof.page < 1 || proof.page > 10000
    || !Number.isInteger(proof.width) || !Number.isInteger(proof.height) || proof.width < 1 || proof.height < 1
    || proof.width * proof.height > 16000000 || !digest(proof.pixelFingerprint)
    || !Array.isArray(proof.glyphs) || proof.glyphs.length !== asset.glyphs.length) return false;
  const seen = new Set(); let points = 0;
  for (const glyph of proof.glyphs) {
    if (!glyph || !scalar(glyph.text) || seen.has(glyph.text) || !asset.glyphs.includes(glyph.text)
      || typeof glyph.sourceId !== 'string' || !glyph.sourceId || glyph.sourceId.length > 160
      || /[<>\x00-\x1f]/.test(glyph.sourceId) || !Number.isFinite(glyph.confidence) || glyph.confidence < .99 || glyph.confidence > 1
      || !Number.isInteger(glyph.points) || glyph.points < 4 || glyph.points > 8192
      || !Array.isArray(glyph.box) || glyph.box.length !== 4 || !glyph.box.every(Number.isInteger)) return false;
    const [x, y, width, height] = glyph.box;
    if (x < 0 || y < 0 || width < 1 || height < 1 || width > 256 || height > 256
      || x + width > proof.width || y + height > proof.height || (points += glyph.points) > OCR_FONT_LIMITS.points) return false;
    seen.add(glyph.text);
  }
  return seen.size === asset.glyphs.length;
}
