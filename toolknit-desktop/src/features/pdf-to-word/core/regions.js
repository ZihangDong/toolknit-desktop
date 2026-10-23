// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union, overlaps, contains, spatialIndex, median } from './geometry.js';
import { groupLines } from './text.js';
import { ruledTables, tableOwnsStroke } from './tables.js';
import { alignedTables } from './aligned-tables.js';
import { longFractionBars } from './math-region-evidence.js';
import { mathGlyphBaseline, mathNaryOperator, centeredMathLimit } from './math-rows.js';
import { glyphRadicals, joinGlyphRootGroups } from './math-glyph-radicals.js';
import { joinMatrixGroups, matrixDelimiterPairs } from './math-matrices.js';
import { inferMathAst } from './math.js';

const expand = (rect, x, y = x) => ({ x: rect.x - x, y: rect.y - y, width: rect.width + x * 2, height: rect.height + y * 2 });
const mathFunctions = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'lg', 'exp', 'lim', 'min', 'max', 'sup', 'inf', 'det', 'dim', 'ker', 'rank', 'tr', 'gcd', 'lcm', 'arg',
  'argmin', 'argmax', 'Re', 'Im', 'Pr', 'relu', 'ReLU', 'softmax', 'sigmoid']);
const mathWords = item => Boolean(item.alphabet) || (item.text.match(/[A-Za-z]{2,}/g) || []).every(word => mathFunctions.has(word)
  || /^[A-Z]{2}$/.test(word) || item.italic && word.length <= 2);
const mathText = item => Boolean(item.delimiterPart) || item.text && (item.text.trim() === '-' || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.text)
  && mathWords(item) && !/[,.;:!?]\s*$/.test(item.text.trim())
  && /^[\p{Script=Latin}\p{Script=Greek}\p{N}\p{Sm}\s()[\]{}|.,'′″°\u00b7\u00b5\u2308-\u230b]+$/u.test(item.text));
const strongMath = item => Boolean(item.alphabet) || item.italic && /^[\p{Script=Latin}\p{Script=Greek}\u00b5]{1,2}$/u.test(item.text || '')
  || /[=<>+*/^_\p{Sm}\u2308-\u230b]/u.test(item.text || '');
const mathEllipsis = item => /^(?:\.{2,3}|\u2026|\u22ef|\u00b7{2,3})$/u.test(String(item.text || '').trim());

function mathScriptLabels(text, candidates) {
  const query = spatialIndex(candidates), visible = spatialIndex(text), existing = new Set(candidates);
  return text.filter(item => {
    if (existing.has(item) || item.raster || item.italic || !/^[a-z]{3,12}$/.test(item.text || '')) return false;
    const bases = query(expand(item.rect, item.size * 2)).filter(base => base.italic
      && /^[\p{Script=Latin}\p{Script=Greek}]$/u.test(base.text) && item.size < base.size * .8
      && item.size >= base.size * .45 && item.rect.x >= right(base.rect) - .15
      && item.rect.x - right(base.rect) <= base.size * .45
      && item.baseline - base.baseline > base.size * .1 && item.baseline - base.baseline < base.size * .65);
    if (bases.length !== 1) return false;
    const box = union([bases[0].rect, item.rect]);
    return !visible(box).some(other => other !== item && other !== bases[0] && overlaps(box, other.rect, .1));
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

function mathAdjacent(a, b) {
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

function bridgeMathStructures(groups, text, longBars, matrixMembers) {
  const textQuery = spatialIndex(text);
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
    const ordered = [...glyphs].sort((a, b) => a.rect.x - b.rect.x);
    const relation = item => item && /^[=\u2260\u2264\u2265]$/.test(item.text.trim()) ? item.rect.y + item.rect.height / 2 : null;
    const matrix = members.some(item => item.delimiterPart && matrixMembers.has(item.id)) && !members.some(item => !item.text)
      && matrixDelimiterPairs(members.filter(item => item.text))
      .find(pair => glyphs.every(item => contains(pair.rect, item.rect, pair.size * .15)));
    return { members, rect: union(members.map(item => item.rect)), size,
      fractionAxis: fraction ? fraction.rect.y + fraction.rect.height / 2 : null,
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
  return components(boxes, linked, boxes.some(box => box.matrixRelation) ? 1.6 : .9).flatMap(component => {
    const members = component.flatMap(box => box.members);
    return component.length > 1 && unobstructed(members) ? [members] : component.map(box => box.members);
  });
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
export function groupPageRegions(text, graphics, rules, sources, { tableFallbackIds = [], tableGrids, bounds } = {}) {
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const graphicsAt = spatialIndex(graphics);
  const tableLines = groupLines(text.filter(item => !item.raster));
  const ruledCandidates = ruledTables(tableLines, rules, tableGrids);
  const candidatesTables = [...ruledCandidates, ...alignedTables(tableLines, [...graphics.map(item => item.rect), ...ruledCandidates.map(table => table.rect)], bounds)];
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
      if (graphicsAt(cell.rect).some(item => !strokeSet.has(item) && overlaps(cell.rect, item.rect, .1)
        && !(item.fillRect && item.opaque !== false && contains(item.rect, cell.rect, 1) && item.order < firstTextOrder)
        && (overlaps(interior, item.rect, .1) || cell.sourceIds.some(id => overlaps(sourceById.get(id).rect, item.rect, 0))))) return false;
      const lines = cell.blocks.flatMap(block => block.lines || []);
      const occupied = lines.reduce((sum, line) => sum + Math.max(line.size * 1.2, line.rect.height), 0);
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
  const availableGraphics = graphics.filter(item => !owned.has(item));
  const availableText = text.filter(item => !tableSourceIds.has(item.id));
  const candidates = availableText.filter(mathText);
  // Small named indices may be words, but ordinary prose is never a bridge.
  candidates.push(...mathScriptLabels(availableText, candidates));
  const mathGlyphs = new Set(candidates);
  const longBars = longFractionBars(availableText, candidates, availableGraphics, strongMath);
  const rootOwners = new Map();
  const fontRoots = glyphRadicals(candidates, availableGraphics.filter(item => item.thin)
    .map(item => ({ ...item, color: item.strokeColor || item.fillColor })));
  for (const root of fontRoots) {
    for (const id of [...root.glyphIds, ...root.strokeIds]) rootOwners.set(id, root.glyphIds[0]);
  }
  const strokes = availableGraphics.filter(item => longBars.has(item) || rootOwners.has(item.id)
    || (item.thin || item.mathGlyph) && Math.max(item.rect.width, item.rect.height) < 100);
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
    || mathAdjacent(a, b)), fontRoots), candidates, acceptMatrix).filter(group => {
    const glyphs = group.filter(item => item.text);
    return glyphs.length && (glyphs.some(strongMath) || glyphs.some(item => matrixMembers.has(item.id)) || group.some(item => !item.text));
  });
  const mathGroups = bridgeMathStructures(includeMathPunctuation(
    bridgeMathEllipses(initialMathGroups, availableText, mathGlyphs), availableText, mathGlyphs), text, longBars, matrixMembers);
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
    const formula = role === 'math' && glyphs.every(item => mathGlyphs.has(item));
    const prefix = [...glyphs].sort((a, b) => a.rect.x - b.rect.x).slice(0, 2).map(item => item.text).join('');
    groups.push({ id: initial[0].id + ':image', type: 'image', role: formula ? 'math' : 'figure', rect, sourceIds,
      order: Math.min(...[...members].map(item => item.order)), reasons,
      baseline: main.length ? median(main.map(item => item.baseline)) : bottom(rect), size,
      optionPrefix: glyphs.every(item => !item.raster) && /^[A-H][.、．]/.test(prefix) ? prefix.slice(0, 2) : '',
      mathGlyphs: formula ? glyphs.map(({ id, text: value, rect: box, baseline, size: fontSize, italic, bold, font, raster, color, alphabet, mathStyleUncertain, radicalPart, delimiterPart }) =>
        ({ id, text: value, rect: box, baseline, size: fontSize, italic, bold, font, raster, color,
          ...(radicalPart ? { radicalPart } : {}),
          ...(delimiterPart ? { delimiterPart } : {}),
          ...(alphabet ? { alphabet } : {}), ...(mathStyleUncertain ? { mathStyleUncertain: true } : {}) })) : undefined,
      mathStrokes: formula ? [...members].filter(item => !item.text).map(({ id, rect: box, thin, mathGlyph, path, strokeColor, fillColor }) => ({ id, rect: box, thin,
        color: strokeColor || fillColor || '000000', unmapped: Boolean(mathGlyph), ...(path ? { path } : {}) })) : undefined,
      decoration: [...members].every(item => item.decoration), thin: [...members].every(item => item.thin),
      drawingIds: [...members].filter(item => !item.text).map(item => item.id) });
  };
  for (const table of fallbackTables) {
    const members = regions.filter(item => contains(expand(table.rect, 2), item.rect) && overlaps(expand(table.rect, 1), item.rect, 0));
    emit(members, 'table');
  }
  // Wide figures are grouped by actual contact first, not by their growing hull.
  const mathMembers = new Set(mathGroups.flat());
  for (const group of components(availableGraphics.filter(item => !mathMembers.has(item)),
    (a, b) => overlaps(expand(a.rect, .3), b.rect, 0))) emit(group, 'figure');
  for (const group of mathGroups) emit(group, 'math');
  for (const item of text.filter(item => item.raster && !tableSourceIds.has(item.id))) emit([item], 'figure');
  return { items: [...text.filter(item => !consumed.has(item) && !tableSourceIds.has(item.id)).map(item => ({ ...item, type: 'text' })), ...tables, ...groups],
    drawingOwnership: [...ownedRules.map(item => ({ id: item.id, owner: 'table' })),
      ...groups.flatMap(group => group.drawingIds.map(id => ({ id, owner: group.id })))],
    risks: [...new Set(groups.flatMap(group => [...group.reasons, ...(group.role === 'math' ? ['math-image'] : [])]))] };
}
