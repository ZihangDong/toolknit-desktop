// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { resultTargets, layoutEditedText, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';
import { textFragments } from '../src/features/pdf-to-word/core/rich-text-edit.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const word = (text, x, font = 'Arial') => ({ text, font, size: 10, color: '000000', preciseInk: true,
  baseline: 30, baselineX: x, advanceWidth: text.length * 5, rect: { x, y: 22, width: text.length * 5, height: 10 } });
const words = [word('Alpha', 10), word('Bravo', 38), word('Charlie', 66, 'Times New Roman')];
const item = { ...word('Alpha Bravo Charlie', 10), id: 'source', type: 'text', words,
  sourceIds: ['source'], rect: { x: 10, y: 22, width: 91, height: 10 } };
const original = inferDocument([{ number: 1, width: 595, height: 842, characters: item.text.length,
  items: [item], risks: [], sources: [{ id: item.id, text: item.text, rect: item.rect, disposition: 'editable' }] }], { preserveGeometry: true });
const page = original.pages[0], target = resultTargets(page).find(t => t.type === 'text');
assert.equal(target.text, item.text);
const measure = (value, style) => [...value].reduce((n, c) => n + (c === 'W' ? 9 : c === 'I' ? 3 : 5), 0) * style.size / 10;
measure.metrics = (_, style) => ({ left: 0, ascent: style.size * .8, descent: style.size * .2 });
const edit = (value, previous) => layoutEditedText(target, value, measure, { page, edits: previous ? { [target.key]: previous } : {} });
const fragments = textFragments(target.lines);
assert.equal(fragments.fragments.filter(f => f.layoutSpace).length, 2, 'word geometry supplies two logical, inferred gaps');
const same = edit('Alpha Cravo Charlie');
const runs = same.lines.flatMap(l => l.items);
assert.deepEqual(runs.map(r => r.text), ['Alpha', 'Cravo', 'Charlie'], 'inferred gaps never become leading characters in a word');
assert.deepEqual(runs.map(r => r.baselineX), [10, 38, 66], 'a substitute space width cannot move source words');
assert.deepEqual(runs[0], { ...target.items[0], ...words[0], words: undefined, sourceLine: 0 });
assert.deepEqual(runs[2], { ...target.items[0], ...words[2], words: undefined, sourceLine: 0 });
assert.equal(runs[2].font, 'Times New Roman');
assert.equal(same.size, target.size);
const narrower = edit('Alpha Iravo Charlie').lines[0].items;
assert.equal(narrower[0].baselineX, 10); assert.equal(narrower[2].baselineX, 66);
const wider = edit('Alpha Wravo Charlie').lines[0].items;
assert.equal(wider[0].baselineX, 10);
assert(wider[2].baselineX >= wider[1].baselineX + wider[1].advanceWidth, 'wider edits reflow instead of overlapping an old suffix anchor');
assert(wider[2].baselineX > 66);

// An untouched source glyph may have a wider substitute-font advance than
// its actual original ink. A preceding edit must not move the untouched pair.
const fitted = structuredClone(target);
fitted.items[0].words[1].advanceWidth = 45;
fitted.lines = [{ ...fitted.lines[0], items: fitted.items }];
const fitEdit = value => layoutEditedText(fitted, value, measure, { page: { ...page, blocks: [] } });
const stableInk = fitEdit('Blpha Bravo Charlie').lines[0].items;
assert.deepEqual(stableInk.map(item => item.baselineX), [10, 38, 66], 'untouched disjoint ink retains both source anchors despite a wide font advance');
assert.equal(stableInk[1].advanceWidth, 45, 'preserving a source anchor does not falsify font advancement');
const changedWide = fitEdit('Alpha Wravo Charlie').lines[0].items;
assert(changedWide[2].baselineX > 66, 'a wider changed predecessor still reflows the suffix');
const overlapping = structuredClone(fitted); overlapping.items[0].words[1].rect.width = 40;
overlapping.lines[0].items = overlapping.items;
const overlapEdit = layoutEditedText(overlapping, 'Blpha Bravo Charlie', measure, { page: { ...page, blocks: [] } });
assert(overlapEdit.lines[0].items[2].baselineX > 66, 'overlapping original ink cannot authorize a backward source anchor');

// A newly typed space inherits typography, never the inferred-gap marker.
const inserted = edit('Alpha  Bravo Charlie');
assert(inserted.runs.some(r => !r.layoutSpace && /\s/.test(r.text)));
const repeated = edit('Alpha  Bravo Charlix', inserted);
assert(repeated.runs.some(r => !r.layoutSpace && /\s/.test(r.text)), 'typed whitespace survives the next edit');
assert.equal(repeated.lines.map(l => l.text).join(''), 'Alpha  Bravo Charlix');
assert.equal(repeated.lines.flatMap(l => l.items).map(r => r.text).join('').replace(/\s/g, ''), 'AlphaBravoCharlix');
const badMeasure = (value, style) => /^\s+$/.test(value) ? NaN : measure(value, style);
assert.throws(() => layoutEditedText(target, 'Alpha Cravo Charlie', badMeasure, { page }), /edit-fit/);

const literal = { ...target, key: '1/literal', text: 'Alpha Bravo Charlie', items: [
  { ...word('Alpha ', 10), id: 'l1', sourceIds: ['l1'] },
  { ...word('Bravo ', 40), id: 'l2', sourceIds: ['l2'] },
  { ...word('Charlie', 70), id: 'l3', sourceIds: ['l3'] }
] };
literal.lines = [{ baseline: 30, rect: literal.rect, items: literal.items }];
const literalEdit = layoutEditedText(literal, 'Alpha Cravo Charlie', measure, { page: { ...page, blocks: [] } });
assert.equal(literalEdit.lines[0].items.map(r => r.text).join(''), 'Alpha Cravo Charlie', 'actual source space characters remain literal');
const soft = { ...target, key: '1/soft', text: 'Alpha Bravo Delta Echo', items: [item],
  rect: { x: 10, y: 22, width: 91, height: 24 }, container: { x: 10, y: 22, width: 400, height: 80 } };
soft.lines = [
  { baseline: 30, rect: item.rect, items: [{ ...item, text: 'Alpha Bravo', words: words.slice(0, 2) }] },
  { baseline: 44, rect: { ...item.rect, y: 36 }, items: [{ ...item, baseline: 44, text: 'Delta Echo', words: [
    { ...word('Delta', 10), baseline: 44, rect: { x: 10, y: 36, width: 25, height: 10 } },
    { ...word('Echo', 38), baseline: 44, rect: { x: 38, y: 36, width: 20, height: 10 } }
  ] }] }
];
const softEdit = layoutEditedText(soft, 'Alpha Bravo Delta Echa', measure, { page: { ...page, blocks: [] } });
assert.deepEqual(softEdit.lines.map(l => l.baseline), [30, 44]);
assert.deepEqual(softEdit.lines.map(l => l.text), ['Alpha Bravo', 'Delta Echa']);
assert.deepEqual(softEdit.lines[1].items.map(r => r.baselineX), [10, 38]);

const updated = applyResultEdits(original, { [target.key]: same });
const bytes = await createWordBytes(updated, [], { preserveGeometry: true });
const zip = await JSZip.loadAsync(bytes.bytes), root = xml2js(await zip.file('word/document.xml').async('string'));
const nodes = n => [n, ...(n.elements || []).flatMap(nodes)];
const rawText = nodes(root).filter(n => n.name === 'w:t').map(n => (n.elements || []).map(c => c.text || '').join('')).join('');
assert.equal(rawText, 'Alpha Cravo Charlie', 'real DOCX contains one gap per original boundary, not a literal-plus-position double space');
assert.equal(original.pages[0], page, 'source document stays immutable');
console.log('Edited word gaps: actual DOCX, source origins, mixed faces, narrower/wider edits, typed/literal/inferred spaces, repeated edits, soft wraps and invalid metrics passed.');
