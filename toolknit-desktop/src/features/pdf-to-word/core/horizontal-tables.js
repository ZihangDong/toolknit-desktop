// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { bottom, right, union, median, contains, overlaps } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { groupLines, lineText, buildParagraphs } from './text.js';
import { LIMITS } from './input.js';
import { partialRuledTable } from './partial-ruled-tables.js';
import { multiHeaderGrid } from './multi-header-tables.js';
import { sparseHorizontalTable } from './sparse-horizontal-tables.js';
import { groupedHorizontalGrid, groupedHeaderBands } from './grouped-horizontal-tables.js';
import { indexedHorizontalTable, indexedRuleBands, exampleHorizontalTable, labelledHorizontalTable } from './indexed-horizontal-tables.js';
import { textualHorizontalTable } from './textual-horizontal-tables.js';

const numeric = text => /^[+−-]?\d[\d.,]*(?:\/\d[\d.,]*)?(?:[%kKmM])?$/u.test(text.trim());
const center = item => item.rect.x + item.rect.width / 2;
const plain = text => text.replace(/\s/gu, '');

/** Only the original horizontal rules may remain behind an unruled Word grid. */
export function horizontalTableRule(item, table) {
  if (table.nativeRules?.length) return Boolean(item.decoration && item.thin && item.opaque !== false
    && table.nativeRules.some(rule => rule.axis === 'h'
      ? item.rect.height <= 2 && Math.abs(item.rect.y + item.rect.height / 2 - rule.at) <= .8
        && Math.abs(item.rect.x - rule.from) <= 1 && Math.abs(right(item.rect) - rule.to) <= 1
      : item.rect.width <= 2 && Math.abs(item.rect.x + item.rect.width / 2 - rule.at) <= .8
        && Math.abs(item.rect.y - rule.from) <= 1 && Math.abs(bottom(item.rect) - rule.to) <= 1));
  return Boolean(table.horizontalRules?.length && item.decoration && item.thin && item.opaque !== false
    && item.rect.height <= 2 && table.horizontalRules.some(rule =>
      Math.abs(item.rect.y + item.rect.height / 2 - rule.at) <= .8
      && item.rect.x >= rule.from - 1 && right(item.rect) <= rule.to + 1
      && item.rect.width >= rule.to - rule.from - 2));
}

function alternateCandidateFor(band, text, rules, bounds) {
  const rect = { x: band[0].from, y: band[0].at, width: band[0].to - band[0].from, height: band.at(-1).at - band[0].at };
  const parents = text.filter(item => overlaps(rect, item.rect, 0));
  if (!parents.length || parents.length > 2000 || parents.some(item => !contains(rect, item.rect, .3))) return null;
  const parts = parents.map(tokensFor);
  if (parts.some(part => !part)) return null;
  const tokens = parts.flat(), table = multiHeaderGrid(band, parents, tokens, rules, bounds)
    || sparseHorizontalTable(band, parents, tokens, rules, bounds)
    || partialRuledTable(band, parents, tokens, rules, bounds)
    || groupedHorizontalGrid(band, parents, tokens, rules, bounds);
  return table ? { parents, tokens, table } : null;
}

function bandsOfRules(rules) {
  const groups = [];
  for (const rule of rules.filter(rule => rule.axis === 'h' && rule.to - rule.from >= 80)) {
    let group = groups.find(group => Math.abs(group[0].from - rule.from) <= 1 && Math.abs(group[0].to - rule.to) <= 1);
    if (!group) groups.push(group = []);
    if (!group.some(other => Math.abs(other.at - rule.at) < .5)) group.push(rule);
  }
  return groups.flatMap(group => {
    const result = []; let current = [];
    for (const rule of group.sort((a,b) => a.at-b.at)) {
      if (current.length && rule.at - current.at(-1).at > 120) { if (current.length >= 3) result.push(current); current = []; }
      current.push(rule);
    }
    if (current.length >= 3) result.push(current);
    return result;
  });
}

function tokensFor(item) {
  if (item.raster || item.alphabet || item.radicalPart || item.delimiterPart || item.mathStyleUncertain) return null;
  if (!(item.words?.length>1)) return [{ ...item, parentId: item.id }];
  const words = item.words.filter(word => word.text?.trim());
  if (!words.length || words.some((word,index) => !contains(item.rect, word.rect, 1)
      || index && word.rect.x < right(words[index-1].rect)-.2)
    || plain(words.map(word => word.text).join('')) !== plain(item.text)) return null;
  const grouped=[];
  for(const word of words){
    const previous=grouped.at(-1),digit=/^[+−\-0-9.,/%kKmM]$/u.test(word.text);
    if(previous?.numeric&&digit&&!word.spaceBefore&&word.rect.x-right(previous.rect)<=item.size*.35){
      previous.parts.push(word);previous.text+=word.text;previous.rect=union(previous.parts.map(part=>part.rect));
    }else grouped.push({...word,parts:[word],numeric:digit});
  }
  return grouped.map(({parts,numeric,...word},index) => ({ ...item, ...word,
    words:parts.length>1?parts:undefined,parentId: item.id,
    id: item.id + ':table-word:' + index, sourceIds: [item.id + ':table-word:' + index],
    advanceWidth:parts.length>1&&Number.isFinite(parts[0].baselineX+parts.at(-1).baselineX+parts.at(-1).advanceWidth)
      ?parts.at(-1).baselineX+parts.at(-1).advanceWidth-parts[0].baselineX:word.advanceWidth,
    baseline: word.baseline ?? item.baseline }));
}

function cellParagraphs(items, rect, baseline = null) {
  if (!items.length) return [];
  if (baseline === null) return buildParagraphs(groupLines(items), rect);
  const ordered = [...items].sort((a,b) => a.rect.x-b.rect.x || a.order-b.order);
  const line = { id: ordered[0].id + ':line', type: 'line', items: ordered, text: lineText(ordered),
    sourceIds: ordered.flatMap(item => item.sourceIds), rect: union(ordered.map(item => item.rect)),
    size: Math.max(...ordered.map(item => item.size)), baseline,
    bold: ordered.every(item => item.bold) };
  return buildParagraphs([line], rect);
}

function candidateFor(band, text, rules, bounds) {
  const top = band[0].at, separator = band[1].at, end = band.at(-1).at;
  const rect = { x: band[0].from, y: top, width: band[0].to-band[0].from, height: end-top };
  if (rect.height < 20 || rect.height > 400 || !contains(bounds, rect, 0)
    || rules.some(rule => rule.axis === 'v' && rule.at > rect.x+1 && rule.at < right(rect)-1 && rule.to > top && rule.from < end)) return null;
  const parents = text.filter(item => overlaps(rect, item.rect, 0));
  if (!parents.length || parents.length > 2000 || parents.some(item => !contains(rect, item.rect, .3))) return null;
  const parts = parents.map(tokensFor);
  if (parts.some(part => !part)) return null;
  const tokens = parts.flat(); if (tokens.length > 4000) return null;
  // Repeated lower alphabetic headers can define another hierarchy level.
  // Numeric sample-size annotations may remain in their existing single cells.
  const headerRows = baselineBands(tokens.filter(item => bottom(item.rect) <= separator + .2));
  if (headerRows.slice(1).some(row => row.filter(item => /\p{L}/u.test(item.text) && !numeric(item.text)).length >= 3)) return null;
  const size = median(tokens.map(token => token.size));
  const data = baselineBands(tokens.filter(token => token.rect.y >= separator-.2))
    .map(items => ({ items, baseline: median(items.filter(item => item.size >= size*.85).map(item => item.baseline)) }))
    .filter(row => row.items.filter(item => numeric(item.text)).length >= 3);
  if (data.length < 3 || data.length > 100) return null;
  const first = data[0].items.filter(item => numeric(item.text)).sort((a,b) => center(a)-center(b));
  if (first.length > 12 || first.length < 3) return null;
  const anchors = first.map(center), tolerance = Math.max(1, size*.75);
  const numericRows = data.map(row => row.items.filter(item => numeric(item.text)).sort((a,b) => center(a)-center(b)));
  if (numericRows.some(row => row.length !== anchors.length || row.some((item,index) => Math.abs(center(item)-anchors[index]) > tolerance))) return null;
  const centers = anchors.map((_,index) => median(numericRows.map(row => center(row[index]))));
  const labels = data.map(row => row.items.filter(item => right(item.rect) < Math.min(...numericRows.map(row => row[0].rect.x))-size*.2));
  const labelParts=labels.flat();
  if (!labelParts.length || labels.filter(items => /[\p{L}]{2}/u.test(items.map(item=>item.text).join(''))).length < data.length*.6) return null;
  centers.unshift(median(labelParts.map(center)));
  if (centers.some((at,index) => index && at-centers[index-1] < size*1.3)) return null;
  const assignment = tokens.map(item => {
    const col = centers.reduce((best,at,index) => Math.abs(center(item)-at) < Math.abs(center(item)-centers[best]) ? index : best, 0);
    let row = 0;
    if (bottom(item.rect) > separator+.2) {
      row = data.reduce((best,value,index) => Math.abs(item.baseline-value.baseline) < Math.abs(item.baseline-data[best].baseline) ? index : best, 0)+1;
      if (Math.abs(item.baseline-data[row-1].baseline) > Math.max(item.size,size)*.75) return null;
    }
    return { item, row, col };
  });
  if (assignment.some(value => !value)) return null;
  const xs = [rect.x];
  for (let col=0;col+1<centers.length;col++) {
    const left = Math.max(...assignment.filter(value => value.col===col).map(value => right(value.item.rect)));
    const next = Math.min(...assignment.filter(value => value.col===col+1).map(value => value.item.rect.x));
    if (!Number.isFinite(left+next) || next-left < Math.max(.5,size*.5)) return null;
    xs.push((left+next)/2);
  }
  xs.push(right(rect));
  const ys = [top, separator];
  for (let index=0;index+1<data.length;index++) {
    const previous = Math.max(...assignment.filter(value => value.row===index+1).map(value => bottom(value.item.rect)));
    const next = Math.min(...assignment.filter(value => value.row===index+2).map(value => value.item.rect.y));
    if (!(next>previous)) return null;
    // Divide unruled rows by their baseline centers, within proven whitespace.
    // Ink-only midpoints vary with descenders and can starve the next ascender;
    // the writer still checks each complete line box before accepting the grid.
    const centered = (data[index].baseline+data[index+1].baseline)/2-size*.3;
    const boundary = Math.max(previous+.1,Math.min(next-.1,centered));
    const rule = band.find(rule => rule.at>=previous && rule.at<=next);
    ys.push(rule?.at ?? boundary);
  }
  ys.push(end);
  if (ys.some((at,index) => index && at-ys[index-1] < size*1.1)) return null;
  const cells=[];
  for (let row=0;row+1<ys.length;row++) for (let col=0;col+1<xs.length;col++) {
    const cellRect={x:xs[col],y:ys[row],width:xs[col+1]-xs[col],height:ys[row+1]-ys[row]};
    const items=assignment.filter(value => value.row===row&&value.col===col).map(value => value.item);
    if (items.some(item => !contains(cellRect,item.rect,.2))) return null;
    cells.push({row,col,rowSpan:1,colSpan:1,rect:cellRect,sourceIds:items.flatMap(item=>item.sourceIds),
      blocks:cellParagraphs(items,cellRect,row?data[row-1].baseline:null)});
  }
  return {parents,tokens,table:{id:parents[0].id+':horizontal-table',type:'table',borderless:true,rect,
    horizontalRules:band.map(rule=>({...rule})),columnWidths:xs.slice(1).map((x,index)=>x-xs[index]),
    rowHeights:ys.slice(1).map((y,index)=>y-ys[index]),rows:ys.length-1,cells,sourceIds:tokens.flatMap(item=>item.sourceIds)}};
}

function partitionSource(source, parts) {
  const output = parts.map(item => ({ ...source, id: item.id, text: item.text, rect: item.rect,
    ...(item.id !== source.id ? { splitFrom: source.id } : {}) }));
  if (!source.encodingCorrections?.length) return output;
  const usedGlyphs = new Set(); let lastEnd = 0;
  for (const correction of source.encodingCorrections) {
    const range = correction.textRange;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < lastEnd
      || range[1] <= range[0] || range[1] > source.text.length || source.text.slice(...range) !== correction.to
      || !Number.isInteger(correction.glyph) || correction.glyph < 0 || usedGlyphs.has(correction.glyph)) return null;
    usedGlyphs.add(correction.glyph); lastEnd = range[1];
  }
  if (parts.length === 1 && parts[0].id === source.id) return output;
  const ranges = []; let cursor = 0;
  for (const item of parts) {
    while (/\s/u.test(source.text[cursor] || '') && cursor < source.text.length) cursor++;
    if (!item.text || source.text.slice(cursor, cursor + item.text.length) !== item.text) return null;
    ranges.push([cursor, cursor + item.text.length]); cursor += item.text.length;
  }
  if (source.text.slice(cursor).trim()) return null;
  const evidence = parts.map(() => []);
  for (const correction of source.encodingCorrections) {
    let owner = ranges.findIndex(([start,end]) => start <= correction.textRange[0] && end >= correction.textRange[1]);
    let whitespace = false;
    if (owner < 0) {
      if (!/^\s+$/u.test(correction.to)) return null;
      whitespace = true;
      owner = ranges.findIndex(([start]) => start >= correction.textRange[1]);
      if (owner < 0) owner = ranges.length - 1;
    }
    // These indices refer to the original PDF operation, not to the child.
    // Retain every correction exactly once, including non-drawing gap spaces.
    evidence[owner].push({ ...correction, sourceId: source.id, ...(whitespace ? { betweenParts: true } : {}) });
  }
  return output.map((item,i) => ({ ...item, sourceRange: ranges[i], encodingCorrections: evidence[i] }));
}

/** Split a drawing operation only after repeated numeric columns and real rules
 * prove its cell ownership. All original non-whitespace characters survive.
 */
export function prepareHorizontalTables(text, graphics, rules, sources, bounds) {
  const candidates=[],sourceById=new Map(sources.map(source=>[source.id,source]));
  const redrawTargets=new Set(sources.filter(source=>source.disposition==='redraw').map(source=>source.equivalentTo));
  let sourceCount=sources.length;
  const proposals=[...bandsOfRules(rules),...groupedHeaderBands(rules)]
    .map(band=>()=>candidateFor(band,text,rules,bounds)||alternateCandidateFor(band,text,rules,bounds));
  for (const band of [...indexedRuleBands(rules),...indexedRuleBands(rules,{headerless:true})]) proposals.push(()=>{
    const rect={x:band[0].from,y:band[0].at,width:band[0].to-band[0].from,height:band.at(-1).at-band[0].at};
    const parents=text.filter(item=>overlaps(rect,item.rect,0));
    if (!parents.length||parents.length>2000||parents.some(item=>!contains(rect,item.rect,.3))) return null;
    const parts=parents.map(tokensFor);if(parts.some(part=>!part))return null;
    const tokens=parts.flat(),table=band.length===2?labelledHorizontalTable(band,parents,tokens,rules,bounds)
      :indexedHorizontalTable(band,parents,tokens,rules,bounds)||exampleHorizontalTable(band,parents,tokens,rules,bounds)
        ||textualHorizontalTable(band,parents,tokens,rules,bounds);
    return table?{parents,tokens,table}:null;
  });
  for (const propose of proposals) {
    const value=propose();
    if (!value || candidates.some(other=>overlaps(value.table.rect,other.table.rect,0))) continue;
    if (graphics.some(item=>overlaps(value.table.rect,item.rect,0)&&!horizontalTableRule(item,value.table))) continue;
    if (value.parents.some(item=>{const source=sourceById.get(item.id);return !source||source.disposition!=='editable'
      ||redrawTargets.has(item.id)&&item.words?.length>1;})) continue;
    const partitions = new Map();
    for (const parent of value.parents) {
      const partition = partitionSource(sourceById.get(parent.id), value.tokens.filter(item => item.parentId === parent.id));
      if (!partition) break;
      partitions.set(parent.id, partition);
    }
    if (partitions.size !== value.parents.length) continue;
    const growth=value.tokens.length-value.parents.length;
    if(sourceCount+growth>LIMITS.itemsPerPage)continue;
    sourceCount+=growth;
    candidates.push({ ...value, partitions });
  }
  if (!candidates.length) return {text,tables:[]};
  const replacements=new Map();
  for(const value of candidates)for(const parent of value.parents){
    const parts=value.tokens.filter(item=>item.parentId===parent.id).map(({parentId,...item})=>item);
    replacements.set(parent.id,parts);
  }
  const sourcePartitions = new Map(candidates.flatMap(value => [...value.partitions]));
  const nextSources=sources.flatMap(source=>sourcePartitions.get(source.id)||[source]);
  sources.length=0;
  for(const source of nextSources)sources.push(source);
  return {text:text.flatMap(item=>replacements.get(item.id)||[item]),tables:candidates.map(value=>value.table)};
}
