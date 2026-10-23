import assert from 'node:assert/strict';
import { normalizeTexSymbol } from '../src/features/pdf-to-word/core/tex-symbol.js';

const polygon = [[0, 10], [10, 10], [10, 9], [5.5, 9], [5.5, 0], [4.5, 0], [4.5, 9], [0, 9]];
const path = points => [...points.map((args, index) => ({ command: index ? 'lineTo' : 'moveTo', args })), { command: 'closePath', args: [] }];
const source = { fontName: 'ABCDEF+CMSY7', embeddedName: 'CMSY7', glyph: { originalCharCode: 62, unicode: '>' }, commands: path(polygon) };
assert.equal(normalizeTexSymbol(source).text, '\u22a4');
const bottom = { ...source, glyph: { originalCharCode: 63, unicode: '?' }, commands: path(polygon.map(([x, y]) => [x, 10 - y])) };
assert.equal(normalizeTexSymbol(bottom).text, '\u22a5');
for (const mutation of [value => { value.embeddedName = 'OtherFont'; }, value => { value.glyph.originalCharCode = 61; },
  value => { value.commands.pop(); }, value => { value.commands[0].args[0] = NaN; },
  value => { value.commands = path([[0, 10], [10, 5], [0, 0], [0, 1], [8, 5], [0, 9]]); },
  value => { value.commands = bottom.commands; }, value => { value.commands = Array.from({ length: 129 }, () => ({ command: 'closePath', args: [] })); },
  value => { value.commands.push(...path([[20, 0], [22, 0], [22, 2], [20, 2]])); }]) {
  const invalid = structuredClone(source); mutation(invalid);
  assert.deepEqual(normalizeTexSymbol(invalid), { uncertain: true }, 'font, code and a complete matching outline are all required');
}
assert.equal(normalizeTexSymbol({ ...source, fontName: 'Helvetica', embeddedName: 'Helvetica' }), null,
  'a legitimate greater-than sign outside this known TeX encoding is untouched');
assert.equal(normalizeTexSymbol({ ...source, glyph: { originalCharCode: 62, unicode: '\u22a4' } }), null,
  'already correct Unicode is preserved');
for (let index = 0; index < 50; index++) {
  const scale = .1 + index / 10, shifted = structuredClone(source);
  shifted.commands = path(polygon.map(([x, y]) => [x * scale + index, y * scale - index]));
  assert.equal(normalizeTexSymbol(shifted).text, '\u22a4');
}
const degenerate = structuredClone(source);
degenerate.commands.unshift({ command: 'moveTo', args: [0, 0] }, { command: 'closePath', args: [] });
assert.equal(normalizeTexSymbol(degenerate).text, '\u22a4', 'an empty contour does not become a semantic component');
const corner = [[0, 0], [3, 0], [3, .4], [.4, .4], [.4, 10], [0, 10]];
for (const [unicode, code, text, top, left] of [['b', 98, '\u230a', false, true], ['c', 99, '\u230b', false, false],
  ['d', 100, '\u2308', true, true], ['e', 101, '\u2309', true, false]]) {
  const points = corner.map(([x, y]) => [left ? x : 3 - x, top ? 10 - y : y]);
  const entry = { ...source, glyph: { unicode, originalCharCode: code }, commands: path(points) };
  assert.equal(normalizeTexSymbol(entry).text, text);
  for (let index = 0; index < 50; index++) {
    const scale = .1 + index / 10;
    assert.equal(normalizeTexSymbol({ ...entry, commands: path(points.map(([x, y]) => [x * scale + index, y * scale - index])) }).text, text);
  }
  assert.deepEqual(normalizeTexSymbol({ ...entry, commands: path(points.map(([x, y]) => [3 - x, y])) }), { uncertain: true },
    'a right delimiter cannot be relabelled as a left delimiter');
  assert.deepEqual(normalizeTexSymbol({ ...entry, commands: path(points.map(([x, y]) => [x, 10 - y])) }), { uncertain: true },
    'a floor cannot be relabelled as a ceiling');
  assert.deepEqual(normalizeTexSymbol({ ...entry, glyph: { unicode, originalCharCode: code + 1 } }), { uncertain: true });
  assert.deepEqual(normalizeTexSymbol({ ...entry, commands: path([[0, 0], [3, 0], [3, 10], [0, 10]]) }), { uncertain: true });
  assert.equal(normalizeTexSymbol({ ...entry, fontName: 'CMMI10' }), null, 'ordinary italic letters retain their text');
}
console.log('TeX symbol checks passed: encoding plus outline, transpose/floor/ceiling orientation, scale invariance and unknown-shape fallback.');
