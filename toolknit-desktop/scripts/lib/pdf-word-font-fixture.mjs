import assert from 'node:assert/strict';
import { GlobalFonts } from '@napi-rs/canvas';

// Never register a substitute under a real font's name: that can change
// unrelated tests' candidate set and cannot certify the missing face.
const optional = new Set(['SimHei', 'FangSong', 'KaiTi']);
export function fixtureFonts(names) {
  const available = [];
  for (const name of names) {
    if (GlobalFonts.has(name)) available.push(name);
    else if (optional.has(name)) console.log(`Optional real-${name} pixel fixture unavailable; common-face contracts still run.`);
    else assert.fail(`Required pixel-fixture font is unavailable: ${name}`);
  }
  assert(available.length, 'A pixel-fixture matrix cannot silently become empty');
  return available;
}
