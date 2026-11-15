// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRawStream, PDFNull, ParseSpeeds } from 'pdf-lib';
import { buildSourceTtf, inspectSourceTtf, SOURCE_FONT_LIMITS, sourceFontAssetId, sourceFontCandidateName, sourceFontUnicodeMap } from '../core/source-font.js';
import { LIMITS, wordError } from '../core/input.js';

const key = value => PDFName.of(value);
const get = (context, dictionary, name) => {
  try { return context.lookup(dictionary.get(key(name))); } catch { return null; }
};
const pdfName = value => value instanceof PDFName ? value.decodeText() : null;
const one = (context, value) => {
  if (!(value instanceof PDFArray)) return value;
  if (value.size() !== 1) return null;
  try { return context.lookup(value.get(0)); } catch { return null; }
};

/** Pull small compressed chunks through the native bounded stream. In particular,
 * never call an unbounded arrayBuffer/decode on a hostile embedded font stream.
 */
export async function readSourceFontStream(stream, context, maximum, check = () => {}) {
  if (!(stream instanceof PDFRawStream) || !Number.isInteger(maximum) || maximum < 1 || maximum > SOURCE_FONT_LIMITS.bytes) return null;
  const contents = stream.getContents();
  if (!contents.length || contents.length > maximum) return null;
  const filter = one(context, get(context, stream.dict, 'Filter')), params = one(context, get(context, stream.dict, 'DecodeParms'));
  if (params && params !== PDFNull) return null;
  if (!filter || filter === PDFNull) { check(); return contents.slice(); }
  if (!['FlateDecode', 'Fl'].includes(pdfName(filter)) || typeof DecompressionStream !== 'function') return null;
  let cursor = 0, reader, chunks = [], length = 0;
  try {
    const compressed = new ReadableStream({ pull(controller) {
      check();
      if (cursor === contents.length) { controller.close(); return; }
      const end = Math.min(contents.length, cursor + 256); controller.enqueue(contents.subarray(cursor, end)); cursor = end;
    } });
    reader = compressed.pipeThrough(new DecompressionStream('deflate')).getReader();
    for (;;) {
      check(); const { value, done } = await reader.read(); check(); if (done) break;
      length += value.length; if (length > maximum) { await reader.cancel(); return null; } chunks.push(value);
    }
    const bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes;
  } catch (error) {
    check(); if (error?.code === 'cancelled' || error?.name === 'AbortError') throw error;
    return null;
  } finally {
    if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    chunks = [];
  }
}

const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');

/** Read ORIGINAL programs for permission and Identity-H mapping. Browser-repaired
 * PDF.js font bytes are deliberately not an input to this authorization boundary.
 */
export async function collectSourceFontAssets(bytes, pages, check = () => {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > LIMITS.inputBytes || !Array.isArray(pages)
    || pages.length < 1 || pages.length > LIMITS.selectedPages || pages.some(n => !Number.isSafeInteger(n) || n < 1)) return [];
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Fast }); }
  catch { check(); return []; }
  check();
  if (pdf.getPageCount() > LIMITS.documentPages || pages.some(n => n > pdf.getPageCount())) return [];
  const context = pdf.context, found = new Map(), ambiguous = new Set(), seen = new Set(), seenFonts = new Set(); let visited = 0, fontVisits = 0, total = 0;
  const collectFont = async font => {
    if (seenFonts.has(font) || ++fontVisits > 512) return; seenFonts.add(font);
    const name = pdfName(get(context, font, 'BaseFont'));
    if (!sourceFontCandidateName(name) || ambiguous.has(name) || pdfName(get(context, font, 'Encoding')) !== 'Identity-H') return;
    if (!found.has(name) && found.size >= SOURCE_FONT_LIMITS.fonts) return;
    const descendants = get(context, font, 'DescendantFonts');
    if (!(descendants instanceof PDFArray) || descendants.size() !== 1) return;
    let child; try { child = context.lookup(descendants.get(0)); } catch { return; }
    if (!(child instanceof PDFDict) || pdfName(get(context, child, 'Subtype')) !== 'CIDFontType2'
      || pdfName(get(context, child, 'CIDToGIDMap')) !== 'Identity') return;
    const descriptor = get(context, child, 'FontDescriptor'); if (!(descriptor instanceof PDFDict)) return;
    const original = await readSourceFontStream(get(context, descriptor, 'FontFile2'), context, SOURCE_FONT_LIMITS.bytes, check); check();
    if (!original || !inspectSourceTtf(original)) return;
    const unicode = await readSourceFontStream(get(context, font, 'ToUnicode'), context, 256 * 1024, check); check();
    const mapping = unicode && sourceFontUnicodeMap(unicode); if (!mapping) return;
    const signature = new TextEncoder().encode(JSON.stringify([...mapping].sort((a, b) => a[0] - b[0]))), input = new Uint8Array(original.length + signature.length);
    input.set(original); input.set(signature, original.length);
    const digest = await sha256(input); check();
    if (found.has(name)) {
      if (found.get(name).sourceFingerprint !== digest) {
        const previous = found.get(name); found.delete(name); ambiguous.add(name);
        if (![...found.values()].some(asset => asset.sourceFingerprint === previous.sourceFingerprint)) total -= previous.bytes.length;
      }
      return;
    }
    if (found.size >= SOURCE_FONT_LIMITS.fonts) return;
    const shared = [...found.values()].find(asset => asset.sourceFingerprint === digest);
    if (shared) { found.set(name, { ...shared, originalName: name }); return; }
    const result = buildSourceTtf(original, mapping, 'TKPdf' + digest.slice(0, 24));
    if (!result || total + result.bytes.length > SOURCE_FONT_LIMITS.totalBytes) return;
    const fingerprint = await sha256(result.bytes); check(); total += result.bytes.length;
    found.set(name, { id: sourceFontAssetId(result.name), kind: 'font', format: 'ttf', name: result.name, originalName: name,
      bytes: result.bytes, fsType: result.fsType, weight: result.weight, bold: result.bold, italic: result.italic,
      glyphs: [...mapping.keys()].map(point => String.fromCodePoint(point)).join(''), fingerprint, sourceFingerprint: digest });
  };
  const resources = async (dictionary, depth = 0) => {
    check(); if (!(dictionary instanceof PDFDict) || seen.has(dictionary) || depth > 8 || ++visited > 512) return;
    seen.add(dictionary);
    const fonts = get(context, dictionary, 'Font');
    if (fonts instanceof PDFDict) for (const [, reference] of fonts.entries()) {
      check(); let font; try { font = context.lookup(reference); } catch { continue; }
      if (font instanceof PDFDict) await collectFont(font);
    }
    const forms = get(context, dictionary, 'XObject');
    if (forms instanceof PDFDict) for (const [, reference] of forms.entries()) {
      check(); let form; try { form = context.lookup(reference); } catch { continue; }
      if (form instanceof PDFRawStream && pdfName(get(context, form.dict, 'Subtype')) === 'Form') await resources(get(context, form.dict, 'Resources'), depth + 1);
    }
  };
  for (const number of [...new Set(pages)]) { check(); await resources(pdf.getPage(number - 1).node.Resources()); }
  return [...found.values()];
}

const walk = function* (blocks) {
  for (const item of blocks || []) {
    if (item.type === 'text') yield item;
    for (const key of ['cells', 'columns']) for (const child of item[key] || []) yield* walk(child.blocks);
    for (const line of item.lines || []) yield* walk(line.items);
  }
};

/** One worker/session owns all font faces. Data is returned as ordinary bounded
 * assets only after a real visible text run uses it. Terminating the worker also
 * destroys its FontFaceSet; the main editor has a separate explicit font scope.
 */
export function createSourceFontRegistry({ makeFace = (name, data, options) => new FontFace(name, data, options), fontSet = globalThis.fonts,
  available = () => ({ fonts: SOURCE_FONT_LIMITS.fonts, bytes: SOURCE_FONT_LIMITS.totalBytes }) } = {}) {
  const byName = new Map(), byId = new Map(), loaded = new Map(), used = new Set(); let disposed = false, prepared = false;
  const heldBytes = () => [...byId.values()].reduce((sum, asset) => sum + asset.bytes.length, 0);
  const capacity = () => {
    try {
      const value = available();
      return value && Number.isInteger(value.fonts) && value.fonts >= 0 && value.fonts <= SOURCE_FONT_LIMITS.fonts
        && Number.isInteger(value.bytes) && value.bytes >= 0 && value.bytes <= SOURCE_FONT_LIMITS.totalBytes ? value : null;
    } catch { return null; }
  };
  const fits = asset => { const free = capacity(); return free && loaded.size < free.fonts && heldBytes() + asset.bytes.length <= free.bytes; };
  return {
    async prepare(bytes, pages, check = () => {}) {
      if (disposed || prepared || !fontSet) return; prepared = true;
      for (const asset of await collectSourceFontAssets(bytes, pages, check)) {
        check(); let face;
        const shared = byId.get(asset.id);
        if (shared) {
          if (shared.fingerprint === asset.fingerprint) byName.set(asset.originalName, shared);
          continue;
        }
        if (!fits(asset)) continue;
        try { face = makeFace(asset.name, asset.bytes, { weight: String(asset.weight), style: asset.italic ? 'italic' : 'normal' }); await face.load(); check(); }
        catch { check(); continue; }
        if (disposed) return;
        // The OCR owner may commit while this real FontFace is loading.
        // Check the shared allowance again immediately before synchronous commit.
        if (!fits(asset)) continue;
        fontSet.add(face); loaded.set(asset.id, face); byName.set(asset.originalName, asset); byId.set(asset.id, asset);
      }
    },
    apply(scene, check = () => {}) {
      if (disposed) return;
      const sources = new Map((scene.sources || []).map(source => [source.id, source]));
      for (const item of walk(scene.items)) {
        check(); const asset = byName.get(item.font), source = item.sourceIds?.length === 1 && sources.get(item.sourceIds[0]);
        if (!asset || item.size < 20 || item.size > 120 || Math.abs((item.horizontalScale ?? 1) - 1) > .002 || item.ocr || item.raster || !item.preciseInk || !source
          || source.id !== item.id || source.encodingCorrections?.length || Boolean(item.bold) !== asset.bold || Boolean(item.italic) !== asset.italic
          || [...item.text].some(character => character.trim() && !asset.glyphs.includes(character))) continue;
        item.sourceFont = item.font; item.sourceSize = item.size; item.font = asset.name; item.fontFamily = asset.name; item.fontAssetId = asset.id; used.add(asset.id);
      }
    },
    assets() { return [...used].map(id => byId.get(id)); },
    capacity() { return { fonts: SOURCE_FONT_LIMITS.fonts - loaded.size,
      bytes: SOURCE_FONT_LIMITS.totalBytes - heldBytes() }; },
    dispose() { if (disposed) return; disposed = true; for (const face of loaded.values()) fontSet?.delete(face); loaded.clear(); byName.clear(); byId.clear(); used.clear(); }
  };
}
