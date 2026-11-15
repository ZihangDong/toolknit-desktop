// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { leafBlocks } from '../core/layout.js';
import { inspectSourceTtf, isSourceFontName, SOURCE_FONT_LIMITS, sourceFontAssetId } from '../core/source-font.js';
import { wordError } from '../core/input.js';
import { documentFontAssetId, validOcrFontProvenance } from '../core/document-font.js';
import { isOcrFontName } from '../core/ocr-font-ttf.js';
import { inspectOcrFontProgram } from '../core/ocr-font-program.js';
import { createOcrFontContext } from './ocr-font-context.js';
import { localOcrTextFont } from './docx-fonts.js';

const fingerprint = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');

export async function validateSourceFontAsset(asset) {
  if (!asset || asset.kind !== 'font' || asset.format !== 'ttf' || !isSourceFontName(asset.name) || asset.id !== sourceFontAssetId(asset.name)
    || asset.origin !== undefined && asset.origin !== 'original-pdf-font-program'
    || !(asset.bytes instanceof Uint8Array) || !/^[0-9a-f]{64}$/.test(asset.fingerprint || '')) throw wordError('structure');
  const info = inspectSourceTtf(asset.bytes);
  if (!info || info.fsType !== asset.fsType || info.bold !== Boolean(asset.bold) || info.italic !== Boolean(asset.italic)
    || asset.weight !== info.weight || await fingerprint(asset.bytes) !== asset.fingerprint) throw wordError('structure');
  return info;
}

export async function validateDocumentFontAsset(asset) {
  if (!isOcrFontName(asset?.name)) return validateSourceFontAsset(asset);
  if (asset.kind !== 'font' || asset.format !== 'ttf' || !validOcrFontProvenance(asset)) throw wordError('structure');
  const info = inspectSourceTtf(asset.bytes);
  const generatedProgram = inspectOcrFontProgram(asset.bytes, asset.name, asset.glyphs, asset.bold, asset.ocrProvenance.glyphs);
  if (!info || info.fsType !== 0 || info.bold !== asset.bold || info.italic !== false
    || info.weight !== asset.weight || !generatedProgram
    || await fingerprint(asset.bytes) !== asset.fingerprint) throw wordError('structure');
  return { ...info, generatedProgram };
}

function* texts(document) {
  for (const page of document.pages) for (const block of leafBlocks([...page.header, ...page.blocks, ...page.footer]))
    for (const line of block.lines || []) for (const item of line.items) {
      if (item.type === 'image') continue;
      if (item.words?.length > 1 || item.words?.some(word => word.fontAssetId)) for (const word of item.words) yield { ...item, ...word };
      else yield item;
    }
}

/** The actual visible text must own each embedded face. Unused registry assets
 * are not added to the package; a missing/mismatched reference is never guessed.
 */
export async function sourceFontOptions(document, assets, { onFont = () => {} } = {}) {
  const needed = new Map();
  for (const item of texts(document)) if (item.fontAssetId) {
    if (item.fontAssetId !== documentFontAssetId(item.font)) throw wordError('structure');
    needed.set(item.fontAssetId, item.font);
  }
  if (needed.size > SOURCE_FONT_LIMITS.fonts) throw wordError('asset-large');
  const options = [], seen = new Set(); let bytes = 0;
  for (const asset of assets) {
    if (!needed.has(asset.id)) continue;
    if (seen.has(asset.id) || asset.name !== needed.get(asset.id)) throw wordError('structure'); seen.add(asset.id);
    const info = await validateDocumentFontAsset(asset); bytes += asset.bytes.length;
    if (bytes > SOURCE_FONT_LIMITS.totalBytes) throw wordError('asset-large');
    onFont(asset, info);
    const face = asset.bold ? asset.italic ? 'boldItalic' : 'bold' : asset.italic ? 'italic' : 'data';
    options.push({ name: asset.name, [face]: asset.bytes });
  }
  if (seen.size !== needed.size) throw wordError('structure');
  return options;
}

/** Main editor ownership is independent from the conversion worker. No font is
 * installed into Windows or retained after this document session is released.
 */
export function createSourceFontScope({ fontSet = globalThis.document?.fonts, makeFace = (name, data, options) => new FontFace(name, data, options), makePath } = {}) {
  const loaded = new Map(), pending = new Map(), generatedFonts = createOcrFontContext({ makePath }); let disposed = false;
  const alive = check => { check(); if (disposed) throw wordError('cancelled'); };
  return {
    has(id) { return loaded.has(id); },
    get loading() { return pending.size > 0; },
    async ensure(assets, check = () => {}) {
      for (const asset of assets.filter(value => value.kind === 'font')) {
        alive(check);
        if (loaded.has(asset.id)) { if (loaded.get(asset.id).asset.fingerprint !== asset.fingerprint) throw wordError('structure'); continue; }
        if (!fontSet) throw wordError('structure');
        if (!pending.has(asset.id)) {
          const reserved = [...pending].filter(([id]) => !loaded.has(id));
          const held = [...loaded.values()].reduce((sum, value) => sum + value.asset.bytes.length, 0)
            + reserved.reduce((sum, [, value]) => sum + value.bytes, 0);
          if (loaded.size + reserved.length >= SOURCE_FONT_LIMITS.fonts || !(asset.bytes instanceof Uint8Array)
            || asset.bytes.length + held > SOURCE_FONT_LIMITS.totalBytes) throw wordError('asset-large');
          const work = (async () => {
            // The document owns a shared load. A cancelled thumbnail/render may
            // stop awaiting it, but must not cancel another page's same face.
            const info = await validateDocumentFontAsset(asset); alive(() => {});
            if (typeof asset.glyphs !== 'string' || [...asset.glyphs].length > SOURCE_FONT_LIMITS.glyphs) throw wordError('structure');
            const face = makeFace(asset.name, asset.bytes, { weight: String(asset.weight), style: asset.italic ? 'italic' : 'normal' });
            await face.load(); alive(() => {});
            try {
              fontSet.add(face); generatedFonts.add(asset, info.generatedProgram);
              loaded.set(asset.id, { asset, face, glyphs: new Set(asset.glyphs) });
            } catch (error) { fontSet.delete(face); generatedFonts.remove(asset.name); throw error; }
          })();
          pending.set(asset.id, { work, fingerprint: asset.fingerprint, bytes: asset.bytes.length });
        }
        const entry = pending.get(asset.id);
        if (entry.fingerprint !== asset.fingerprint) throw wordError('structure');
        try { await entry.work; alive(check); } finally { if (pending.get(asset.id) === entry) pending.delete(asset.id); }
      }
    },
    context(context) { return generatedFonts.context(context); },
    insertedStyle(text, style) {
      if (!style.fontAssetId) return style;
      const entry = loaded.get(style.fontAssetId);
      if (!entry) throw wordError('busy');
      if ([...text].every(character => !character.trim() || entry.glyphs.has(character))) return style;
      // A PDF subset cannot supply characters absent from its program. Resolve
      // only newly typed glyphs to an explicit local face; retain all old runs.
      const font = (isOcrFontName(style.font) && localOcrTextFont(style.ocrFallbackFont, text))
        || (/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(text) ? 'Microsoft YaHei' : 'Arial');
      return { ...style, text, sourceFont: style.font, sourceSize: style.size, font, fontFamily: font,
        fontAssetId: undefined, fontMetrics: undefined, words: undefined, glyphScale: undefined, advanceWidth: undefined };
    },
    dispose() { if (disposed) return; disposed = true; generatedFonts.dispose(); for (const { face } of loaded.values()) fontSet?.delete(face); loaded.clear(); pending.clear(); }
  };
}
