import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { identifyTexRadicalPart } from '../src/features/pdf-to-word/core/tex-radical.js';
import { glyphRadicals } from '../src/features/pdf-to-word/core/math-glyph-radicals.js';
import { inferMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { validateAiScope, planAiScopes, aiScopePayload, applyAiScope } from '../src/features/pdf-to-word/core/ai-v2.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { mathGlyphBaseline } from '../src/features/pdf-to-word/core/math-rows.js';

const path = points => [...points.map((args, index) => ({ command: index ? 'lineTo' : 'moveTo', args })), { command: 'closePath', args: [] }];
const shapes = {
  cap: [[0, 0], [.4, 0], [.4, 5.6], [3.6, 5.6], [3.6, 6], [0, 6]],
  stem: [[0, 0], [.4, 0], [.4, 6.4], [0, 6.4]],
  hook: [[5.6, 0], [6, 0], [6, 18], [5.6, 18], [5.6, 2.6], [1.35, 15.9], [0, 13.5], [.2, 13.2], [1, 14.8]],
};
const codes = { cap: 118, stem: 117, hook: 116 };
for (const [part, polygon] of Object.entries(shapes)) {
  const sample = { fontName: 'ABCDEF+CMEX10', embeddedName: 'CMEX10', glyph: { unicode: '\u221a', originalCharCode: codes[part] }, commands: path(polygon) };
  assert.deepEqual(identifyTexRadicalPart(sample), { part });
  for (const scale of [.2, 1, 20]) assert.deepEqual(identifyTexRadicalPart({ ...sample,
    commands: path(polygon.map(([x, y]) => [x * scale + 17, y * scale - 31])) }), { part });
  for (const change of [value => { value.embeddedName = 'OtherFont'; }, value => { value.commands[0].args[0] = NaN; },
    value => { value.commands.pop(); }, value => { value.commands = [null]; }, value => { value.glyph.accent = {}; },
    value => { value.commands = Array.from({ length: 129 }, () => ({ command: 'closePath', args: [] })); }]) {
    const changed = structuredClone(sample); change(changed); assert.deepEqual(identifyTexRadicalPart(changed), { uncertain: true });
  }
  if (part !== 'stem') assert.deepEqual(identifyTexRadicalPart({ ...sample, commands: path(polygon.map(([x, y]) => [-x, y])) }), { uncertain: true });
  assert.equal(identifyTexRadicalPart({ ...sample, fontName: 'Times-Roman' }), null);
}
const part = (id, kind, x, y, width, height) => ({ id, text: '\u221a', radicalPart: kind,
  rect: { x, y, width, height }, baseline: y + .4, size: 10, color: '000000', font: 'CMEX10', italic: false, bold: false });
const region = { id: 'root', role: 'math', reasons: [], rect: { x: 14.4, y: 10, width: 43, height: 30 },
  mathGlyphs: [part('cap', 'cap', 20, 10, 3.6, 6), part('stem', 'stem', 20, 15.6, .4, 6.4), part('hook', 'hook', 14.4, 21.6, 6, 18),
    { id: 'x', text: 'x', rect: { x: 27, y: 19, width: 6, height: 8 }, baseline: 27, size: 10, font: 'Cambria Math', italic: true, bold: false, color: '000000' }],
  mathStrokes: [{ id: 'bar', rect: { x: 23.2, y: 10, width: 34, height: .4 }, color: '000000', thin: true,
    path: { id: 'bar', segment: 0, from: [23.4, 10.2], to: [57, 10.2], paint: 'stroke', complete: true, color: '000000' } }] };
assert.equal(glyphRadicals(region.mathGlyphs, region.mathStrokes).length, 1);
const ast = inferMathAst(region);
assert.equal(ast?.type, 'radical'); assert.deepEqual(ast.glyphIds, ['cap', 'stem', 'hook']); assert.equal(ast.radicand.sourceId, 'x');
const delimiter = { type: 'text', text: '(', rect: { x: 10, y: 20, width: 3, height: 12 }, size: 10, baseline: 20.4, font: 'CMEX10' };
assert.equal(mathGlyphBaseline(delimiter), 28.5, 'a large extension delimiter uses its mathematical axis, not the top font baseline');
assert.equal(mathGlyphBaseline({ ...delimiter, font: 'Other' }), 20.4);
assert.equal(mathGlyphBaseline({ ...delimiter, mathStyleUncertain: true }), 20.4);
assert.equal(delimiter.baseline, 20.4, 'the source baseline is immutable');
for (const change of [value => { value.mathGlyphs.splice(1, 1); }, value => { value.mathGlyphs[1].rect.x += 2; },
  value => { value.mathGlyphs[1].raster = true; }, value => { value.mathGlyphs[2].font = 'CMEX7'; },
  value => { value.mathStrokes[0].path.complete = false; }, value => { value.mathStrokes[0].color = 'FF0000'; },
  value => { value.mathStrokes.push({ ...value.mathStrokes[0], id: 'duplicate-bar' }); }]) {
  const changed = structuredClone(region); change(changed); assert.equal(inferMathAst(changed), null, 'incomplete or competing root evidence stays an image');
}
const request = { schemaVersion: 2, requestId: 'root', inputDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), page: 1, scopeId: 'root',
  kind: 'math', math: { id: 'root', glyphs: region.mathGlyphs, strokes: region.mathStrokes } };
const { kind, math, ...identity } = request;
validateAiScope(JSON.stringify({ ...identity, mathCandidates: [{ id: 'root', ast }] }), request);
const aiDocument = { schemaVersion: 1, pages: [{ number: 1, width: 100, height: 100, header: [], footer: [], risks: [], evidence: [],
  content: region.rect, blocks: [{ ...region, type: 'image', sourceIds: region.mathGlyphs.map(item => item.id) }],
  sources: region.mathGlyphs.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'visible-image' })) }] };
const scope = planAiScopes(aiDocument).find(scope => scope.kind === 'math'); assert(scope);
const payload = aiScopePayload(aiDocument.pages[0], scope);
assert.equal(payload.math.glyphs[0].radicalPart, 'cap'); assert.equal(payload.math.glyphs[0].font, 'CMEX10');
assert.equal(payload.math.glyphs[0].color, '000000'); assert.equal(payload.math.strokes[0].color, '000000');
const scopedRequest = { ...payload, requestId: 'root', inputDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64) };
const scopedIdentity = Object.fromEntries(['schemaVersion', 'requestId', 'inputDigest', 'sourceDigest', 'page', 'scopeId'].map(key => [key, scopedRequest[key]]));
const suggestion = { ...scopedIdentity, mathCandidates: [{ id: 'root', ast }] };
const reviewed = applyAiScope(aiDocument, scope, scopedRequest, suggestion);
assert.equal(reviewed.pages[0].blocks[0].type, 'image'); assert.equal(reviewed.pages[0].blocks[0].aiReview.status, 'needs-review');
for (const changed of [{ ...ast, glyphIds: ['cap', 'hook'] }, { ...ast, glyphIds: ['cap', 'stem', 'stem', 'hook'] },
  { ...ast, degree: ast.radicand }, { ...ast, glyphIds: ['cap', 'x', 'hook'] }]) {
  assert(!validateMathEvidence(changed, region));
  assert.throws(() => validateAiScope(JSON.stringify({ ...identity, mathCandidates: [{ id: 'root', ast: changed }] }), request), /ai-response/);
}
const text = region.mathGlyphs.map(item => ({ ...item, type: 'text', sourceIds: [item.id], order: 1 }));
const graphics = region.mathStrokes.map(item => ({ ...item, type: 'image', sourceIds: [], strokeColor: item.color, order: 2 }));
const sources = text.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable', order: 1 }));
const grouped = groupPageRegions(text, graphics, [], sources).items.filter(item => item.type === 'image');
assert.equal(grouped.length, 1); assert.equal(grouped[0].sourceIds.length, 4); assert.deepEqual(grouped[0].drawingIds, ['bar']);
const before = structuredClone(region); inferMathAst(region); assert.deepEqual(region, before);
const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({
  children: [nativeMath(ast, region, { measurementContext: createCanvas(1, 1).getContext('2d') })], run: { size: 20 }
})] }] }));
const zip = await JSZip.loadAsync(docx), xml = await zip.file('word/document.xml').async('string');
assert.equal((xml.match(/<m:rad>/g) || []).length, 1); assert(!xml.includes('<m:t>\u221a</m:t>'));
await mkdir('tmp/pdf-word-math/glyph-radicals', { recursive: true });
await writeFile('tmp/pdf-word-math/glyph-radicals/supported.docx', docx);
console.log('Glyph radicals passed: font/slot/outline binding, connected components, top rule, missing/colored/clipped/duplicate rejection, AI ownership and one native root.');
