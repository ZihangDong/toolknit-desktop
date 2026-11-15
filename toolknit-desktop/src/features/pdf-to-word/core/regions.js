// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { sourceAlignedEquationCandidates } from './source-aligned-equations.js';
import { sourceUpperAttachmentCandidates } from './source-upper-attachment.js';
import {sourceIndexedSumCandidates} from './source-indexed-sum.js';
import {sourceScalarRelationCandidates} from './source-scalar-relation.js';
import { sourceFirstLevelIndexCandidates } from './source-first-level-index.js';
import { nativeUnicodeScalarCandidates } from './native-unicode-scalars.js';
import { bottom, right, union, overlaps, contains, spatialIndex, median } from './geometry.js';
import { groupLines } from './text.js';
import { ruledTables, tableOwnsStroke } from './tables.js';
import { alignedTables } from './aligned-tables.js';
import { centeredTextTables } from './centered-text-tables.js';
import { partitionedTextTables } from './partitioned-text-tables.js';
import { horizontalTableRule } from './horizontal-tables.js';
import { longFractionBars, nativeSubscriptOwners, nativeDecimalPoints, nativeFootnoteMarkers, nativeNonFractionRules, nativeFunctionClosings } from './math-region-evidence.js';
import { mathGlyphBaseline, mathNaryOperator, centeredMathLimit } from './math-rows.js';
import { glyphRadicals, joinGlyphRootGroups } from './math-glyph-radicals.js';
import { joinMatrixGroups, matrixDelimiterPairs } from './math-matrices.js';
import { inferMathAst } from './math.js';
import { mathClassificationText } from './font-style.js';
import { planNativeMathRuns, nativeMathRunParts } from './math-limit-runs.js';
import { nativeMathReaderMode } from './native-math-policy.js';
import { proseFragments } from './prose-fragments.js';
import { sourceMathAccent, sourceAccentNeighbor } from './math-accents.js';

const expand = (rect, x, y = x) => ({ x: rect.x - x, y: rect.y - y, width: rect.width + x * 2, height: rect.height + y * 2 });
const mathFunctions = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'lg', 'exp', 'lim', 'min', 'max', 'sup', 'inf', 'det', 'dim', 'ker', 'rank', 'tr', 'gcd', 'lcm', 'arg',
  'argmin', 'argmax', 'Re', 'Im', 'Pr', 'relu', 'ReLU', 'softmax', 'sigmoid']);
const mathWords = (item, text) => {
  const styled = text !== item.text;
  return Boolean(item.alphabet) || (text.match(/[A-Za-z]{2,}/g) || []).every(word => mathFunctions.has(word)
    || /^[A-Z]{2}$/.test(word) || (item.italic || styled) && word.length <= 2);
};
const mathTextFor = (item, unicode) => {
  const text = unicode ? mathClassificationText(item.text) : item.text;
  return sourceMathAccent(item) || Boolean(item.delimiterPart) || item.text && (item.text.trim() === '-' || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.text)
    && mathWords(item, text) && !/[,.;:!?]\s*$/.test(item.text.trim()) && (unicode || !/[;:]/u.test(text))
    && /^[\p{Script=Latin}\p{Script=Greek}\p{N}\p{Sm}\s()[\]{}|.,:;'′″°\u00b7\u00b5\u2308-\u230b]+$/u.test(text));
};
const mathText = item => mathTextFor(item, true);
const legacyMathText = item => mathTextFor(item, false);
const strongMath = item => Boolean(item.alphabet) || item.italic && /^[\p{Script=Latin}\p{Script=Greek}\u00b5]{1,2}$/u.test(item.text || '')
  || /[=<>+*/^_\p{Sm}\u2308-\u230b]/u.test(item.text || '');
const mathEllipsis = item => /^(?:\.{2,3}|\u2026|\u22ef|\u00b7{2,3})$/u.test(String(item.text || '').trim());

function mathScriptLabels(text, candidates) {
  const query = spatialIndex(candidates), visible = spatialIndex(text), existing = new Set(candidates);
  return text.filter(item => {
    if (existing.has(item) || item.raster || item.italic || !/^[a-z]{3,12}$/.test(item.text || '')) return false;
    const bases = query(expand(item.rect, item.size * 2)).map(original => {
      const parts = nativeMathRunParts(original);
      // Compound-run labels are restricted to the native typewriter face.
      const base = parts && /^(?:[A-Z]{6}\+)?CMTT(?:[5-9]|1[012])$/.test(item.font || '') ? parts.at(-1) : original;
      return { original, base };
    }).filter(({ base }) => (base.italic || mathClassificationText(base.text) !== base.text)
      && /^[\p{Script=Latin}\p{Script=Greek}]$/u.test(mathClassificationText(base.text)) && item.size < base.size * .8
      && item.size >= base.size * .45 && item.rect.x >= right(base.rect) - .15
      && item.rect.x - right(base.rect) <= base.size * .45
      && item.baseline - base.baseline > base.size * .1 && item.baseline - base.baseline < base.size * .65);
    if (bases.length !== 1) return false;
    const box = union([bases[0].base.rect, item.rect]);
    return !visible(box).some(other => other !== item && other !== bases[0].original && overlaps(box, other.rect, .1));
  });
}

function components(items, linked, reach = .9) {
  const query = spatialIndex(items), visited = new Set(), groups = [];
  for (const seed of items) {
    if (visited.has(seed)) continue;
    const group = [], queue = [seed]; visited.add(seed);
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]; group.push(item);
      for (const other of query(expand(item.rect, Math.max(2, (item.size || 12) * reach)))) {
        if (!visited.has(other) && linked(item, other)) { visited.add(other); queue.push(other); }
      }
    }
    groups.push(group);
  }
  return groups;
}

function mathAdjacent(a, b, indexOwners) {
  if (indexOwners && Math.abs(a.baseline - b.baseline) > Math.max(a.size, b.size) * .65
    && (indexOwners.has(a) && indexOwners.get(a) !== b || indexOwners.has(b) && indexOwners.get(b) !== a)) return false;
  if (sourceMathAccent(a) || sourceMathAccent(b)) return sourceAccentNeighbor(a, b) || sourceAccentNeighbor(b, a);
  if (!a.text && !b.text) return overlaps(expand(a.rect, .25), b.rect, 0);
  if (!a.text || !b.text) {
    const glyph = a.text ? a : b, line = a.text ? b : a;
    if (!(line.thin || line.mathGlyph) || line.rect.width > glyph.size * 10 || line.rect.height > glyph.size * 3) return false;
    return overlaps(expand(glyph.rect, glyph.size * .35, glyph.size * .65), line.rect, 0);
  }
  for (const [base, item] of [[a, b], [b, a]]) if (mathNaryOperator({ ...base, type: 'symbol' })
    && (centeredMathLimit(base, [item]) || centeredMathLimit(base, [item], true))) return true;
  const size = Math.min(a.size, b.size), baseline = Math.abs(mathGlyphBaseline(a) - mathGlyphBaseline(b));
  const gap = Math.max(a.rect.x, b.rect.x) - Math.min(right(a.rect), right(b.rect));
  if (baseline <= size * .3 && gap <= size * .65) return true;
  const differentEm = Math.min(a.size, b.size) < Math.max(a.size, b.size) * .88;
  const small = differentEm ? a.size < b.size ? a : b : a.rect.height < b.rect.height ? a : b;
  const large = small === a ? b : a;
  return (small.size < large.size * .88 || small.rect.height < large.rect.height * .8) && baseline < large.size * 1.1
    && small.rect.x >= large.rect.x && gap < large.size * .5;
}

function bridgeMathEllipses(groups, text, mathGlyphs) {
  const parents = groups.map((_, index) => index), ownership = new Map();
  groups.forEach((group, index) => group.forEach(item => ownership.set(item, index)));
  const root = index => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  const query = spatialIndex(groups.flat()), added = [];
  for (const item of text.filter(mathEllipsis)) {
    if (ownership.has(item)) continue;
    const neighbours = query(expand(item.rect, item.size * .9)).filter(other => mathAdjacent(item, other));
    const left = neighbours.filter(other => right(other.rect) <= item.rect.x + .3);
    const after = neighbours.filter(other => other.rect.x >= right(item.rect) - .3);
    // Require mathematical content on both sides. Repeated dot leaders and
    // ordinary prose punctuation must not become formula membership evidence.
    if (!left.length || !after.length) continue;
    const ids = [...new Set([...left, ...after].map(other => root(ownership.get(other))))];
    const owner = Math.min(...ids);
    ids.forEach(id => { parents[id] = owner; });
    added.push({ item, owner }); mathGlyphs.add(item);
  }
  const merged = new Map();
  groups.forEach((group, index) => { const id = root(index); if (!merged.has(id)) merged.set(id, []); merged.get(id).push(...group); });
  for (const { item, owner } of added) merged.get(root(owner)).push(item);
  return [...merged.values()];
}

function mathGroupEvidence(group) {
  const glyphs = group.filter(item => item.text);
  return { role: 'math', sourceIds: glyphs.flatMap(item => item.sourceIds), mathGlyphs: glyphs,
    mathStrokes: group.filter(item => !item.text).map(item => ({ ...item,
      color: item.strokeColor || item.fillColor || '000000', unmapped: Boolean(item.mathGlyph) })),
    reasons: [...new Set(group.map(item => item.reason).filter(reason => reason && reason !== 'image'))] };
}

/** Whole-class closure. A tail is claimed only after complete source,
 * AST and collision checks; no general adjacency distance is enlarged. */
function closeShorthandEquations(groups, text, graphics, mathGlyphs) {
  const visible = spatialIndex([...text, ...graphics]), textSet = new Set(text), proposals = [], claims = new Map();
  let remaining = 256;
  for (const group of groups) {
    if (group.length > 96) continue;
    const operator = group.find(g => g.text === '∫' && /^(?:[A-Z]{6}\+)?XITSMath-Regular$/.test(g.font || ''));
    if (!operator) continue;
    const rect = union(group.map(g => g.rect)), baseline = operator.rect.y + operator.rect.height / 2 + operator.size * .25;
    const neighbours = visible({ x: right(rect) - .3, y: baseline - operator.size, width: operator.size * 1.2, height: operator.size * 1.5 });
    if (neighbours.length > 128) continue;
    const tails = neighbours.filter(g => textSet.has(g) && !group.includes(g) && g.font === operator.font && g.preciseInk && g.raster === false
      && /^\)[.,]?$/.test(g.text || '') && Math.abs(g.baseline - baseline) <= operator.size * .08
      && Math.abs(g.size - operator.size) <= .05 && g.rect.x >= right(rect) - .3
      && g.rect.x - right(rect) <= operator.size * .8).slice(0, 8);
    const valid = [];
    for (const tail of [null, ...tails]) {
      if (--remaining < 0) return groups;
      const members = tail ? [...group, tail] : group, evidence = mathGroupEvidence(members);
      const plan = planNativeMathRuns(evidence), ast = plan?.ast || inferMathAst(evidence);
      if (!ast || nativeMathReaderMode(ast, plan?.region || evidence) !== 'xits-shorthand-equation') continue;
      const owned = new Set(members), box = union(members.map(g => g.rect));
      if (visible(box).some(g => !owned.has(g) && overlaps(box, g.rect, .1))) continue;
      valid.push(members);
    }
    if (valid.length !== 1) continue;
    proposals.push({ group, members: valid[0] });
    for (const member of valid[0]) claims.set(member, (claims.get(member) || 0) + 1);
  }
  const accepted = proposals.filter(p => p.members.every(g => claims.get(g) === 1));
  for (const p of accepted) for (const g of p.members.filter(g => g.text)) mathGlyphs.add(g);
  const replacements = new Map(accepted.map(p => [p.group, p.members]));
  return groups.map(g => replacements.get(g) || g);
}

function joinBlackboardSpaces(groups, text, graphics) {
  if (!groups.some(group => group.some(g => g.alphabet === 'doubleStruck' && g.text === 'R'))) return groups;
  const boxes = groups.map(members => ({ members, rect: union(members.map(item => item.rect)) }));
  const nearby = spatialIndex(boxes), visible = spatialIndex([...text, ...graphics]);
  const proposals = [], claims = new Map(); let attempts = 256;
  for (const power of boxes.filter(box => box.members.some(g => g.alphabet === 'doubleStruck' && g.text === 'R'))) {
    const size = Math.max(...power.members.filter(g => g.text).map(g => g.size));
    const left = nearby(expand(power.rect, size * 4, size * .2)).filter(box => box !== power
      && box.rect.x < power.rect.x && right(box.rect) <= power.rect.x + .3).slice(0, 8);
    const options = [...left.map(box => [box]), ...left.flatMap((a, i) => left.slice(i + 1).map(b => [a, b]))];
    const valid = [];
    for (const prefix of options) {
      if (--attempts < 0) break;
      const members = [...prefix.flatMap(box => box.members), ...power.members];
      const evidence = mathGroupEvidence(members), ast = inferMathAst(evidence);
      if (ast?.type !== 'row' || nativeMathReaderMode(ast, evidence) !== 'blackboard-space') continue;
      const owned = new Set(members), rect = union(members.map(g => g.rect));
      if (!visible(rect).some(g => !owned.has(g) && overlaps(rect, g.rect, .1))) valid.push([...prefix, power]);
    }
    if (valid.length !== 1) continue;
    proposals.push(valid[0]);
    for (const box of valid[0]) claims.set(box, (claims.get(box) || 0) + 1);
  }
  const accepted = proposals.filter(group => group.every(box => claims.get(box) === 1));
  const consumed = new Set(accepted.flat());
  return [...boxes.filter(box => !consumed.has(box)).map(box => box.members),
    ...accepted.map(group => group.flatMap(box => box.members))];
}

function bridgeMathStructures(groups, text, longBars, matrixMembers, graphics, completeRatioOnly = false) {
  const textQuery = spatialIndex(text), graphicsQuery = spatialIndex(graphics);
  const memberOwners = new Set(groups.flat());
  const dotClaims = new Map();
  const additions = groups.map(members => {
    // An isolated multiplication dot can lie between two nested fractions.
    // Include it only inside an already connected group with no other owner.
    const rect = union(members.map(item => item.rect));
    const interiorDots = textQuery(rect).filter(item => !memberOwners.has(item) && item.text?.trim() === '\u00b7'
      && contains(rect, item.rect, 0));
    for (const item of interiorDots) dotClaims.set(item, (dotClaims.get(item) || 0) + 1);
    return interiorDots;
  });
  const boxes = groups.map((members, index) => {
    members = [...members, ...additions[index].filter(item => dotClaims.get(item) === 1)];
    const semantic = members.filter(item => item.text && !item.radicalPart);
    const glyphs = semantic.length ? semantic : members.filter(item => item.text), largest = Math.max(...glyphs.map(item => item.size));
    const primary = glyphs.filter(item => item.size >= largest * .9), size = median(primary.map(item => item.size));
    const fraction = members.filter(item => longBars.has(item)).sort((a, b) => b.rect.width - a.rect.width)[0];
    const shortLines = members.filter(item => !item.text && item.thin && item.rect.width >= size * .5
      && item.rect.height <= Math.min(1.5, size * .12));
    const ordered = [...glyphs].sort((a, b) => a.rect.x - b.rect.x);
    const relation = item => item && /^[=\u2260\u2264\u2265]$/.test(item.text.trim()) ? item.rect.y + item.rect.height / 2 : null;
    const matrix = members.some(item => item.delimiterPart && matrixMembers.has(item.id)) && !members.some(item => !item.text)
      && matrixDelimiterPairs(members.filter(item => item.text))
      .find(pair => glyphs.every(item => contains(pair.rect, item.rect, pair.size * .15)));
    return { members, rect: union(members.map(item => item.rect)), size,
      fractionAxis: fraction ? fraction.rect.y + fraction.rect.height / 2 : null,
      candidateAxis: shortLines.length === 1 ? shortLines[0].rect.y + shortLines[0].rect.height / 2 : null,
      leftRelation: relation(ordered[0]), rightRelation: relation(ordered.at(-1)),
      matrixAxis: matrix ? matrix.rect.y + matrix.rect.height / 2 : null,
      baseline: matrix ? matrix.baseline : median(primary.map(mathGlyphBaseline)) };
  });
  const unobstructed = members => {
    const rect = union(members.map(item => item.rect)), owned = new Set(members);
    return !textQuery(rect).some(item => !owned.has(item) && overlaps(rect, item.rect, .1));
  };
  const linked = (a, b) => {
    const size = Math.min(a.size, b.size);
    const gap = Math.max(a.rect.x, b.rect.x) - Math.min(right(a.rect), right(b.rect));
    const [left, after] = a.rect.x <= b.rect.x ? [a, b] : [b, a];
    const sameAxis = (left.fractionAxis !== null && after.leftRelation !== null
      && Math.abs(left.fractionAxis - after.leftRelation) <= size * .18)
      || (after.fractionAxis !== null && left.rightRelation !== null
        && Math.abs(after.fractionAxis - left.rightRelation) <= size * .18);
    const ratioAxis = after.fractionAxis ?? after.candidateAxis;
    if (gap >= -.3 && gap <= size * .9 && ratioAxis !== null && left.rightRelation !== null
      && Math.abs(ratioAxis - left.rightRelation) <= size * .18) {
      const members = [...left.members, ...after.members], owned = new Set(members), rect = union(members.map(item => item.rect));
      const evidence = mathGroupEvidence(members), ast = inferMathAst(evidence);
      // A leading standalone fraction inherits a different Office line frame.
      // Admit the wider relation gap only for the proven complete expression.
      if (ast && nativeMathReaderMode(ast, evidence) === 'exponential-ratio' && unobstructed(members)
        && !graphicsQuery(rect).some(item => !owned.has(item) && overlaps(rect, item.rect, .1))) return true;
    }
    if (completeRatioOnly) return false;
    return gap >= -.3 && gap <= size * (a.matrixRelation || b.matrixRelation ? 1.5 : .65) && (Math.abs(a.baseline - b.baseline) <= size * .3 || sameAxis)
      && unobstructed([...a.members, ...b.members]);
  };
  for (const relation of boxes.filter(box => box.leftRelation !== null && box.rightRelation !== null)) {
    relation.matrixRelation = boxes.some(box => box.matrixAxis !== null && Math.abs(box.matrixAxis - relation.leftRelation) <= Math.min(box.size, relation.size) * .2
      && Math.max(box.rect.x, relation.rect.x) - Math.min(right(box.rect), right(relation.rect)) <= Math.min(box.size, relation.size) * 1.5
      && unobstructed([...box.members, ...relation.members]));
  }
  // Compare complete groups on their main baseline: numerous small indices
  // must not split an equation at normal relation/operator spacing.
  const result = components(boxes, linked, boxes.some(box => box.matrixRelation) ? 1.6 : .9).flatMap(component => {
    const members = component.flatMap(box => box.members);
    return component.length > 1 && unobstructed(members) ? [members] : component.map(box => box.members);
  });
  // An indexed left side and its relation can first become one ordinary math
  // group. One bounded closure pass may join that complete prefix to the ratio;
  // it admits only the proven native expression, not further generic joins.
  return !completeRatioOnly && result.length < groups.length
    ? bridgeMathStructures(result, text, longBars, matrixMembers, graphics, true) : result;
}

function includeMathPunctuation(groups, text, mathGlyphs) {
  const punctuation = spatialIndex(text.filter(item => /^[,;:]$/.test(item.text?.trim())));
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const claims = new Map();
  const additions = groups.map(group => {
    const stack = [], spans = [];
    for (const glyph of group.filter(item => item.text).sort((a, b) => a.rect.x - b.rect.x)) {
      for (const character of glyph.text) {
        if ('([{'.includes(character)) stack.push({ character, glyph });
        else if (pairs[character]) {
          const opening = stack.pop();
          if (!opening || opening.character !== pairs[character]) { stack.length = 0; continue; }
          if (Math.abs(opening.glyph.baseline - glyph.baseline) <= Math.max(opening.glyph.size, glyph.size) * .3)
            spans.push({ left: right(opening.glyph.rect), right: glyph.rect.x, rect: union([opening.glyph.rect, glyph.rect]) });
        }
      }
    }
    const added = new Set();
    for (const span of spans) for (const item of punctuation(span.rect)) {
      if (item.rect.x >= span.left && right(item.rect) <= span.right && contains(span.rect, item.rect, .1)) {
        added.add(item);
      }
    }
    for (const item of added) claims.set(item, (claims.get(item) || 0) + 1);
    return added;
  });
  return groups.map((group, index) => [...new Set([...group, ...[...additions[index]].filter(item => {
    if (claims.get(item) !== 1) return false;
    mathGlyphs.add(item); return true;
  })])]);
}

/** Form ownership before rectangular crops. A mathematical group keeps all its
 * symbols together; table strokes are consumed only by a proven native grid.
 */
export function groupPageRegions(text, graphics, rules, sources, { tableFallbackIds = [], tableGrids, horizontalTables = [], bounds } = {}) {
  horizontalTables = [...horizontalTables, ...partitionedTextTables(text, rules, sources, bounds)
    .filter(table => !horizontalTables.some(other => overlaps(table.rect, other.rect, 0)))];
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const graphicsAt = spatialIndex(graphics);
  const tableLines = groupLines(text.filter(item => !item.raster));
  const ruledCandidates = ruledTables(tableLines, rules, tableGrids)
    .filter(table => !horizontalTables.some(prepared => contains(prepared.rect, table.rect, .5)));
  const excluded = [...graphics.map(item => item.rect), ...ruledCandidates.map(table => table.rect), ...horizontalTables.map(table => table.rect)];
  const aligned = alignedTables(tableLines, excluded, bounds);
  const candidatesTables = [...horizontalTables, ...ruledCandidates, ...aligned,
    ...centeredTextTables(tableLines, [...excluded, ...aligned.map(table => table.rect)], bounds, sources)];
  const tableOwners = new Map(), ambiguousTables = new Set();
  for (const table of candidatesTables) for (const id of table.sourceIds) {
    const previous = tableOwners.get(id);
    if (previous) { ambiguousTables.add(previous); ambiguousTables.add(table); }
    else tableOwners.set(id, table);
  }
  const canWriteTable = table => {
    if (ambiguousTables.has(table) || tableFallbackIds.includes(table.id)) return false;
    if (text.some(item => item.raster && overlaps(table.rect, item.rect, .1))) return false;
    const strokes = graphicsAt(expand(table.rect, 1)).filter(item => tableOwnsStroke(item, table));
    if (strokes.some(item => item.opaque === false || (item.strokeColor || item.fillColor || '000000') !== '000000'
      || (item.strokeWidth || Math.min(item.rect.width, item.rect.height)) > 1)) return false;
    const strokeSet = new Set(strokes);
    return table.cells.every(cell => {
      const firstTextOrder = Math.min(...cell.sourceIds.map(id => sourceById.get(id).order));
      const interior = expand(cell.rect, -.5);
      // A partial or translucent backdrop cannot become uniform cell shading.
      // Cropping it unchanged beneath editable text would retain duplicate ink.
      if (graphicsAt(cell.rect).some(item => !strokeSet.has(item) && !horizontalTableRule(item, table) && overlaps(cell.rect, item.rect, .1)
        && !(item.fillRect && item.opaque !== false && contains(item.rect, cell.rect, 1) && item.order < firstTextOrder)
        && (overlaps(interior, item.rect, .1) || cell.sourceIds.some(id => overlaps(sourceById.get(id).rect, item.rect, 0))))) return false;
      const lines = cell.blocks.flatMap(block => block.lines || []);
      const occupied = lines.reduce((sum, line) => sum + (table.nativeRules?.length && line.items.every(item => item.preciseInk)
        ? line.rect.height : Math.max(line.size * 1.2, line.rect.height)), 0);
      return occupied <= cell.rect.height + .25;
    });
  };
  const tables = candidatesTables.filter(canWriteTable), fallbackTables = candidatesTables.filter(table => !table.borderless && !tables.includes(table));
  const tableSourceIds = new Set(tables.flatMap(table => table.sourceIds));
  const tableBackgrounds = new Set();
  for (const table of tables) for (const cell of table.cells) {
    const firstTextOrder = Math.min(...cell.sourceIds.map(id => sourceById.get(id).order));
    for (const item of graphics) if (item.fillRect && contains(table.rect, item.rect, 1)
      && contains(item.rect, cell.rect, 1) && item.order < firstTextOrder) {
      cell.shading = item.fillColor; tableBackgrounds.add(item);
    }
  }
  const ownedRules = graphics.filter(item => tableBackgrounds.has(item) || tables.some(table => tableOwnsStroke(item, table)));
  const owned = new Set(ownedRules);
  // Joining crossing original rules into their rectangular hull would crop the
  // newly editable text back into a second, undeletable table image.
  const preservedRules = graphics.filter(item => !owned.has(item)
    && tables.some(table => table.nativeRules?.length && horizontalTableRule(item, table)));
  const preservedRuleSet = new Set(preservedRules);
  const availableGraphics = graphics.filter(item => !owned.has(item) && !preservedRuleSet.has(item));
  const availableText = text.filter(item => !tableSourceIds.has(item.id));
  const prose = proseFragments(availableText);
  const footnotes = nativeFootnoteMarkers(availableText);
  const formMathGroups = inputCandidates => {
    const candidates = inputCandidates.filter(item => !footnotes.has(item));
    candidates.push(...nativeDecimalPoints(availableText));
    // Small named indices may be words, but ordinary prose is never a bridge.
    candidates.push(...mathScriptLabels(availableText, candidates));
    const mathGlyphs = new Set(candidates);
    const indexOwners = nativeSubscriptOwners(candidates);
    const longBars = longFractionBars(availableText, candidates, availableGraphics, strongMath);
    const rootOwners = new Map();
    const fontRoots = glyphRadicals(candidates, availableGraphics.filter(item => item.thin)
      .map(item => ({ ...item, color: item.strokeColor || item.fillColor })));
    for (const root of fontRoots) {
      for (const id of [...root.glyphIds, ...root.strokeIds]) rootOwners.set(id, root.glyphIds[0]);
    }
    const nonFractionRules = nativeNonFractionRules(candidates, availableGraphics);
    const strokes = availableGraphics.filter(item => longBars.has(item) || rootOwners.has(item.id)
      || !nonFractionRules.has(item) && (item.thin || item.mathGlyph) && Math.max(item.rect.width, item.rect.height) < 100);
    const matrixMembers = new Set();
    const acceptMatrix = pair => {
      const delimiterIds = new Set([...pair.left, ...pair.right].map(item => item.id));
      const glyphs = availableText.filter(item => delimiterIds.has(item.id) || contains(pair.content, item.rect, pair.size * .15));
      const rules = availableGraphics.filter(item => contains(pair.content, item.rect, .2)).map(item => ({ ...item,
        color: item.strokeColor || item.fillColor, unmapped: Boolean(item.mathGlyph) }));
      const ast = inferMathAst({ role: 'math', reasons: [], mathGlyphs: glyphs, mathStrokes: rules });
      if (ast?.type !== 'matrix') return false;
      glyphs.forEach(item => matrixMembers.add(item.id)); return true;
    };
    const initialMathGroups = joinMatrixGroups(joinGlyphRootGroups(components([...candidates, ...strokes], (a, b) => longBars.get(a)?.has(b)
      || longBars.get(b)?.has(a) || rootOwners.has(a.id) && rootOwners.get(a.id) === rootOwners.get(b.id)
      || mathAdjacent(a, b, indexOwners)), fontRoots), candidates, acceptMatrix).filter(group => {
      const glyphs = group.filter(item => item.text);
      return glyphs.length && (glyphs.some(strongMath) || glyphs.some(item => matrixMembers.has(item.id)) || group.some(item => !item.text));
    });
    const mathGroups = joinBlackboardSpaces(bridgeMathStructures(includeMathPunctuation(
      bridgeMathEllipses(nativeFunctionClosings(initialMathGroups, availableText), availableText, mathGlyphs), availableText, mathGlyphs), text, longBars, matrixMembers, availableGraphics), text, availableGraphics);
    return { mathGroups: closeShorthandEquations(mathGroups, availableText, availableGraphics, mathGlyphs), mathGlyphs };
  };
  const candidates = availableText.filter(item => !prose.has(item) && mathText(item));
  let { mathGroups, mathGlyphs } = formMathGroups(candidates);
  if (candidates.some(item => !legacyMathText(item))) {
    const legacy = formMathGroups(availableText.filter(item => !prose.has(item) && legacyMathText(item)));
    const changed = new Set([...mathGlyphs].filter(item => !legacy.mathGlyphs.has(item)));
    const visible = spatialIndex([...availableText, ...availableGraphics]);
    const accepted = mathGroups.filter(group => {
      if (!group.some(item => changed.has(item))) return false;
      const members = new Set(group), rect = union(group.map(item => item.rect));
      if (legacy.mathGroups.some(old => old.some(item => members.has(item)) && !old.every(item => members.has(item)))
        || visible(rect).some(item => !members.has(item) && overlaps(rect, item.rect, .1))) return false;
      const evidence = mathGroupEvidence(group);
      const plan = planNativeMathRuns(evidence), ast = plan?.ast || inferMathAst(evidence);
      const mode = ast && nativeMathReaderMode(ast, plan?.region || evidence);
      const unicode = group.some(item => changed.has(item) && item.text !== mathClassificationText(item.text));
      return mode && (!unicode || mode === 'unicode' || mode === 'atomic' || mode === 'xits-shorthand-equation');
    });
    // A better candidate must not turn previously editable native letters into
    // a larger fallback picture. Preserve the old partitions until the entire
    // additional group has a supported source-bound Word representation.
    const promoted = new Set(accepted.flat());
    mathGroups = [...legacy.mathGroups.filter(group => !group.some(item => promoted.has(item))), ...accepted];
    mathGlyphs = new Set([...legacy.mathGlyphs, ...accepted.flat().filter(item => item.text)]);
  }
  // Isolated whole indices close before the separate scalar pass. Existing
  // complete formulas retain ownership and no general adjacency gate changes.
  const indexedSums=new Map();
  for(const proposal of sourceIndexedSumCandidates(availableText,availableGraphics,sources,mathGroups)){
    const ast=inferMathAst(proposal.region);if(!ast||nativeMathReaderMode(ast,proposal.region)!=='source-indexed-sum')continue;
    const members=[...proposal.items,proposal.drawing],own=new Set(members);mathGroups=mathGroups.filter(group=>!group.some(g=>own.has(g)));
    mathGroups.push(members);proposal.items.forEach(g=>{mathGlyphs.add(g);indexedSums.set(g,proposal);});
  }
  const scalarRelations=new Map();
  for(const proposal of sourceScalarRelationCandidates(availableText,availableGraphics,sources,mathGroups)){
    const evidence={type:'image',role:'math',rect:union(proposal.items.map(g=>g.rect)),sourceIds:proposal.items.map(g=>g.id),
      mathGlyphs:proposal.glyphs,mathStrokes:[],drawingIds:[],reasons:[],sourceScalarRelation:proposal.proof};
    const ast=inferMathAst(evidence);
    if(!ast||nativeMathReaderMode(ast,evidence)!=='source-scalar-relation')continue;
    const own=new Set(proposal.items);mathGroups=mathGroups.filter(gr=>!gr.some(g=>own.has(g)));
    mathGroups.push(proposal.items);proposal.items.forEach(g=>{mathGlyphs.add(g);scalarRelations.set(g,proposal);});
  }
  const upperAttachments = new Map();
  for (const proposal of sourceUpperAttachmentCandidates(availableText,availableGraphics,sources,mathGroups)) {
    const evidence={type:'image',role:'math',rect:union(proposal.items.map(g=>g.rect)),
      sourceIds:proposal.items.map(g=>g.id),mathGlyphs:proposal.glyphs,mathStrokes:[],drawingIds:[],reasons:[],sourceUpperAttachment:proposal.proof};
    const ast=inferMathAst(evidence);
    if(!ast||nativeMathReaderMode(ast,evidence)!=='source-upper-attachment')continue;
    const own=new Set(proposal.items);
    mathGroups=mathGroups.filter(group=>!group.some(g=>own.has(g)));
    mathGroups.push(proposal.items);
    proposal.items.forEach(g=>{mathGlyphs.add(g);upperAttachments.set(g,proposal);});
  }
  const alignedEquations = new Map();
  for(const proposal of sourceAlignedEquationCandidates(availableText,availableGraphics,sources,mathGroups)) {
    if(nativeMathReaderMode(proposal.ast,proposal.region)!=='source-aligned-equation')continue;
    const own=new Set(proposal.items);mathGroups=mathGroups.filter(group=>!group.some(item=>own.has(item)));
    mathGroups.push(proposal.items);proposal.items.forEach(item=>{mathGlyphs.add(item);alignedEquations.set(item,proposal);});
  }
  const firstLevelIndices = new Map();
  for (const proposal of sourceFirstLevelIndexCandidates(availableText, availableGraphics, sources, mathGroups)) {
    const evidence = { ...mathGroupEvidence(proposal.items), type: 'image',
      rect: union(proposal.items.map(g => g.rect)), sourceFirstLevelIndex: proposal.proof };
    const ast = inferMathAst(evidence);
    if (ast && nativeMathReaderMode(ast, evidence) === 'xits-first-level-index') {
      mathGroups.push(proposal.items);
      proposal.items.forEach(g => { mathGlyphs.add(g); firstLevelIndices.set(g, proposal); });
    }
  }
  // Existing shorthand groups own their complete members before singletons.
  const scalarSources = new Map(sources.map(source => [source.id, source]));
  const nativeUnicodeScalars = new Map(nativeUnicodeScalarCandidates(availableText, availableGraphics, sources, mathGroups)
    .map(item => { const source = scalarSources.get(item.id);
      return [item, { item, source: { ...source, rect: { ...source.rect } } }]; }));
  for (const [scalar, proof] of nativeUnicodeScalars) {
    const evidence = { ...mathGroupEvidence([scalar]), type: 'image', rect: scalar.rect,
      sourceNativeUnicodeScalar: proof };
    const ast = inferMathAst(evidence);
    if (ast && nativeMathReaderMode(ast, evidence) === 'unicode') mathGroups.push([scalar]);
    else nativeUnicodeScalars.delete(scalar);
  }
  const regions = [...text.filter(item => !tableSourceIds.has(item.id)), ...availableGraphics], query = spatialIndex(regions), consumed = new Set();
  const groups = [];
  const emit = (initial, role) => {
    const members = new Set(initial.filter(item => !consumed.has(item)));
    if (!members.size) return;
    let rect = union([...members].map(item => item.rect)), changed = true;
    // Only the final visible crop may absorb neighbours, after semantic grouping.
    // Precise glyph bounds prevent font-wide boxes from bridging unrelated lines.
    while (changed) {
      changed = false;
      for (const item of query(rect)) if (!consumed.has(item) && !members.has(item) && overlaps(rect, item.rect, .1)) {
        members.add(item); rect = union([rect, item.rect]); changed = true;
      }
    }
    for (const item of members) consumed.add(item);
    const glyphs = [...members].filter(item => item.text), sourceIds = glyphs.flatMap(item => item.sourceIds);
    for (const id of sourceIds) sourceById.get(id).disposition = 'visible-image';
    const sizes = glyphs.map(item => item.size), size = median(sizes) || rect.height;
    const main = glyphs.filter(item => item.size >= size * .9);
    const reasons = [...new Set([...members].map(item => item.reason).filter(reason => reason && reason !== 'image'))];
    if (role === 'table') reasons.push('table-image');
    const formula = role === 'math' && (glyphs.every(item => mathGlyphs.has(item))
      || glyphs.length === 1 && nativeUnicodeScalars.has(glyphs[0]));
    const prefix = [...glyphs].sort((a, b) => a.rect.x - b.rect.x).slice(0, 2).map(item => item.text).join('');
    groups.push({ id: initial[0].id + ':image', type: 'image', role: formula ? 'math' : 'figure', rect, sourceIds,
      order: Math.min(...[...members].map(item => item.order)), reasons,
      baseline: main.length ? median(main.map(item => item.baseline)) : bottom(rect), size,
      ...(formula && glyphs.length === 2 && firstLevelIndices.get(glyphs[0])
        && glyphs.every(g => firstLevelIndices.get(g) === firstLevelIndices.get(glyphs[0]))
        ? { sourceFirstLevelIndex: firstLevelIndices.get(glyphs[0]).proof } : {}),
      ...(formula && glyphs.length === 1 && nativeUnicodeScalars.has(glyphs[0])
        ? { sourceNativeUnicodeScalar: nativeUnicodeScalars.get(glyphs[0]) } : {}),
      optionPrefix: glyphs.every(item => !item.raster) && /^[A-H][.、．]/.test(prefix) ? prefix.slice(0, 2) : '',
      mathGlyphs: formula ? glyphs.map(({ id, text: value, rect: box, baseline, size: fontSize, italic, bold, font, raster, preciseInk, color, alphabet, mathStyleUncertain, radicalPart, delimiterPart, mathGlyphPositions }) =>
        ({ id, text: value, rect: box, baseline, size: fontSize, italic, bold, font, raster, preciseInk: Boolean(preciseInk), color,
          ...(mathGlyphPositions?.length ? { mathGlyphPositions } : {}),
          ...(radicalPart ? { radicalPart } : {}),
          ...(delimiterPart ? { delimiterPart } : {}),
          ...(alphabet ? { alphabet } : {}), ...(mathStyleUncertain ? { mathStyleUncertain: true } : {}) })) : undefined,
      mathStrokes: formula ? [...members].filter(item => !item.text).map(({ id, rect: box, thin, mathGlyph, path, strokeColor, fillColor }) => ({ id, rect: box, thin,
        color: strokeColor || fillColor || '000000', unmapped: Boolean(mathGlyph), ...(path ? { path } : {}) })) : undefined,
      ...(formula&&glyphs.length===3&&scalarRelations.get(glyphs[0])&&glyphs.every(g=>scalarRelations.get(g)===scalarRelations.get(glyphs[0]))
        ?{sourceScalarRelation:scalarRelations.get(glyphs[0]).proof,mathGlyphs:scalarRelations.get(glyphs[0]).glyphs}:{}),
      ...(formula&&glyphs.length===11&&indexedSums.get(glyphs[0])&&glyphs.every(g=>indexedSums.get(g)===indexedSums.get(glyphs[0]))
        ?{sourceIndexedSum:indexedSums.get(glyphs[0]).proof,mathGlyphs:indexedSums.get(glyphs[0]).glyphs,mathStrokes:[indexedSums.get(glyphs[0]).stroke]}:{}),
      ...(formula && glyphs.length===2 && upperAttachments.get(glyphs[0])
        && glyphs.every(g=>upperAttachments.get(g)===upperAttachments.get(glyphs[0]))
        ? {sourceUpperAttachment:upperAttachments.get(glyphs[0]).proof,mathGlyphs:upperAttachments.get(glyphs[0]).glyphs} : {}),
      ...(formula&&glyphs.length===2&&alignedEquations.get(glyphs[0])
        &&glyphs.every(g=>alignedEquations.get(g)===alignedEquations.get(glyphs[0]))
        ?{sourceAlignedEquation:alignedEquations.get(glyphs[0]).proof,mathGlyphs:alignedEquations.get(glyphs[0]).region.mathGlyphs}:{}),
      decoration: [...members].every(item => item.decoration), thin: [...members].every(item => item.thin),
      drawingIds: [...members].filter(item => !item.text).map(item => item.id),
      ...(members.size === 1 && initial[0].rasterSource ? { rasterSource: initial[0].rasterSource } : {}) });
  };
  for (const table of fallbackTables) {
    const members = regions.filter(item => contains(expand(table.rect, 2), item.rect) && overlaps(expand(table.rect, 1), item.rect, 0));
    emit(members, 'table');
  }
  // Wide figures are grouped by actual contact first, not by their growing hull.
  const mathMembers = new Set(mathGroups.flat());
  for (const group of components(availableGraphics.filter(item => !mathMembers.has(item)),
    (a, b) => overlaps(expand(a.rect, .3), b.rect, 0))) emit(group, 'figure');
  for (const group of components(preservedRules, (a, b) => overlaps(expand(a.rect, .3), b.rect, 0)
    && (a.rect.width <= 2 && b.rect.width <= 2 && Math.abs(a.rect.x - b.rect.x) <= .3
      || a.rect.height <= 2 && b.rect.height <= 2 && Math.abs(a.rect.y - b.rect.y) <= .3))) emit(group, 'figure');
  for (const group of mathGroups) emit(group, 'math');
  for (const item of text.filter(item => item.raster && !tableSourceIds.has(item.id))) emit([item], 'figure');
  return { items: [...text.filter(item => !consumed.has(item) && !tableSourceIds.has(item.id)).map(item => ({ ...item, type: 'text' })), ...tables, ...groups],
    drawingOwnership: [...ownedRules.map(item => ({ id: item.id, owner: 'table' })),
      ...groups.flatMap(group => group.drawingIds.map(id => ({ id, owner: group.id })))],
    risks: [...new Set(groups.flatMap(group => [...group.reasons, ...(group.role === 'math' ? ['math-image'] : [])]))] };
}
