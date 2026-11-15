// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { wordError } from '../core/input.js';
import { OCR_FONT_LIMITS } from '../core/ocr-font-ttf.js';
import { SOURCE_FONT_LIMITS } from '../core/source-font.js';

const fontPattern = /^(?:(normal|italic|oblique)\s+)?(?:(normal|bold|[1-9]00)\s+)?(\d+(?:\.\d+)?)px\s+["']?(TKInk[0-9a-f]{24})["']?$/;
// OffscreenCanvas can expose its reset zero spacing as an empty string after
// resize. It has the same native meaning as the initial 0px/normal state.
const spacing = value => value === undefined || value === '' || value === 'normal' ? 0 : /^-?\d+(?:\.\d+)?px$/.test(String(value)) ? parseFloat(value) : null;

/** A document-owned view of validated generated programs. Contexts keep their
 * native methods and state; other fonts/styles/shaping use the original canvas.
 * Cached paths share one bounded allowance across all fonts in the document. */
export function createOcrFontContext({ makePath = typeof Path2D === 'function' ? () => new Path2D() : null } = {}) {
  const fonts = new Map(), paths = new Map(); let contexts = new WeakMap(), points = 0, bytes = 0, disposed = false;
  const remove = name => {
    const old = fonts.get(name); if (old) bytes -= old.bytes;
    fonts.delete(name);
    for (const [key, entry] of paths) if (entry.name === name) { paths.delete(key); points -= entry.points; }
  };
  function parsed(context) {
    if (disposed || context.textBaseline !== 'alphabetic' || !['left', 'start'].includes(context.textAlign)
      || context.direction === 'rtl' || context.fontKerning === 'normal') return null;
    const match = fontPattern.exec(context.font || '');
    if (!match || match[1] && match[1] !== 'normal') return null;
    const entry = fonts.get(match[4]), size = Number(match[3]), bold = match[2] === 'bold' || Number(match[2]) >= 600;
    if (!entry || entry.program.bold !== bold || !Number.isFinite(size) || size <= 0 || size > 10000) return null;
    const letter = spacing(context.letterSpacing), word = spacing(context.wordSpacing);
    if (letter === null || word === null) return null;
    return { ...entry, size, letter, word };
  }
  function measure(text, context) {
    if (typeof text !== 'string' || text.length > 10000) return null;
    const entry = parsed(context); if (!entry) return null;
    const unit = entry.size / entry.program.units, glyphs = [];
    let cursor = 0, left = Infinity, right = -Infinity, top = -Infinity, bottom = -Infinity;
    for (const character of text) {
      const glyph = entry.program.glyph(character); if (!glyph) return null;
      glyphs.push({ character, cursor, glyph });
      if (glyph.points) {
        left = Math.min(left, cursor + glyph.bounds[0] * unit); right = Math.max(right, cursor + glyph.bounds[2] * unit);
        top = Math.max(top, glyph.bounds[3] * unit); bottom = Math.max(bottom, -glyph.bounds[1] * unit);
      }
      cursor += glyph.advance * unit + entry.letter + (character === ' ' || character === '\u00a0' ? entry.word : 0);
    }
    return { entry, unit, glyphs, values: { width: cursor, actualBoundingBoxLeft: Number.isFinite(left) ? -left : 0,
      actualBoundingBoxRight: Number.isFinite(right) ? right : 0, actualBoundingBoxAscent: Number.isFinite(top) ? top : 0,
      actualBoundingBoxDescent: Number.isFinite(bottom) ? bottom : 0,
      fontBoundingBoxAscent: entry.program.ascent * unit, fontBoundingBoxDescent: -entry.program.descent * unit } };
  }
  function pathFor(entry, character) {
    const key = entry.program.name + ':' + character;
    if (paths.has(key)) return paths.get(key).path;
    if (!makePath) return null;
    const glyph = entry.program.glyph(character, true); if (!glyph) return null;
    if (!glyph.points) return false;
    const path = makePath(); let start = 0;
    for (const end of glyph.ends) {
      path.moveTo(glyph.coordinates[start * 2], glyph.coordinates[start * 2 + 1]);
      for (let i = start + 1; i <= end; i++) path.lineTo(glyph.coordinates[i * 2], glyph.coordinates[i * 2 + 1]);
      path.closePath(); start = end + 1;
    }
    while (paths.size >= 256 || points + glyph.points > OCR_FONT_LIMITS.points) {
      const oldest = paths.keys().next().value; if (oldest === undefined) break;
      points -= paths.get(oldest).points; paths.delete(oldest);
    }
    paths.set(key, { name: entry.program.name, points: glyph.points, path }); points += glyph.points;
    return path;
  }
  return {
    add(asset, program) {
      if (disposed) throw wordError('cancelled');
      if (!program) return;
      const old = fonts.get(asset.name);
      if (old) { if (old.fingerprint !== asset.fingerprint) throw wordError('structure'); return; }
      if (!(asset.bytes instanceof Uint8Array) || program.name !== asset.name) throw wordError('structure');
      if (fonts.size >= SOURCE_FONT_LIMITS.fonts || asset.bytes.length + bytes > SOURCE_FONT_LIMITS.totalBytes) throw wordError('asset-large');
      fonts.set(asset.name, { program, fingerprint: asset.fingerprint, bytes: asset.bytes.length }); bytes += asset.bytes.length;
    },
    remove,
    context(context) {
      if (!context || disposed) return context;
      if (contexts.has(context)) return contexts.get(context);
      const methods = new Map();
      const proxy = new Proxy(context, {
        get(target, key) {
          if (methods.has(key)) return methods.get(key);
          const value = Reflect.get(target, key, target);
          if (key === 'measureText' && typeof value === 'function') {
            const fn = text => {
              const native = value.call(target, text), exact = measure(text, target);
              return exact ? new Proxy(native, { get(object, field) { return field in exact.values ? exact.values[field] : Reflect.get(object, field, object); } }) : native;
            }; methods.set(key, fn); return fn;
          }
          if (key === 'fillText' && typeof value === 'function') {
            const fn = (text, x, y, maxWidth) => {
              const exact = makePath && Number.isFinite(x + y) && (maxWidth === undefined || Number.isFinite(maxWidth) && maxWidth > 0) ? measure(text, target) : null;
              if (!exact) return maxWidth === undefined ? value.call(target, text, x, y) : value.call(target, text, x, y, maxWidth);
              const glyphPaths = exact.glyphs.map(glyph => ({ ...glyph, path: pathFor(exact.entry, glyph.character) }));
              if (glyphPaths.some(glyph => glyph.path === null)) return maxWidth === undefined ? value.call(target, text, x, y) : value.call(target, text, x, y, maxWidth);
              const fit = maxWidth === undefined || exact.values.width <= maxWidth ? 1 : maxWidth / exact.values.width;
              target.save();
              try {
                target.translate(x, y); target.scale(fit, 1);
                for (const glyph of glyphPaths) if (glyph.path) {
                  target.save(); try { target.translate(glyph.cursor, 0); target.scale(exact.unit, -exact.unit); target.fill(glyph.path); } finally { target.restore(); }
                }
              } finally { target.restore(); }
            }; methods.set(key, fn); return fn;
          }
          if (typeof value !== 'function') return value;
          const fn = value.bind(target); methods.set(key, fn); return fn;
        },
        set(target, key, value) { return Reflect.set(target, key, value, target); }
      }); contexts.set(context, proxy); return proxy;
    },
    get cachedPoints() { return points; },
    get cachedPaths() { return paths.size; },
    dispose() { if (disposed) return; disposed = true; fonts.clear(); paths.clear(); points = 0; bytes = 0; contexts = new WeakMap(); }
  };
}
