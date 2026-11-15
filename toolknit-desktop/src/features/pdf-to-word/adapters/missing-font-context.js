// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

/** A known unembedded FangZheng Hei alias. Embedded faces remain authoritative. */
export function missingFontAliases(page, fontIds) {
  const aliases = new Map();
  for (const id of fontIds || []) {
    let font;
    try { font = page.commonObjs.get(id); } catch { continue; }
    if (!font?.missingFile || !/^FZH4(?:FW|JW)--GB1-[0-9]+$/i.test(font.name || '')
      || typeof font.loadedName !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(font.loadedName)) continue;
    aliases.set('"' + font.loadedName + '"', '"SimHei"');
    if (aliases.size === 64) break;
  }
  return aliases;
}

/** Override only the canvas font choice. Do not mutate PDF.js font objects,
 * operation lists, system fonts or the user's source document.
 */
export function missingFontContext(context, aliases) {
  if (!aliases?.size) return context;
  return new Proxy(context, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (key === 'font' && typeof value === 'string') for (const [source, family] of aliases)
        if (value.includes(source)) value = value.replace(source, family)
          .replace(/^(normal|italic|oblique) (?:normal|bold|[1-9]00) /, '$1 bold ');
      return Reflect.set(target, key, value, target);
    },
  });
}
