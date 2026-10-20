// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { union } from './geometry.js';
import { glyphRadicals } from './math-glyph-radicals.js';

export const radicalEvidence = (glyphs, strokes) => [...radicalPaths(strokes), ...glyphRadicals(glyphs, strokes)];

const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .05;

/** Complete four-segment radical strokes. Content ownership is checked by the parser. */
export function radicalPaths(strokes) {
  const paths = new Map();
  for (const stroke of strokes) {
    const path = stroke.path;
    if (!path || typeof path.id !== 'string') continue;
    if (!paths.has(path.id)) paths.set(path.id, []);
    paths.get(path.id).push(stroke);
  }
  const result = [];
  for (const members of paths.values()) {
    if (members.length !== 4) continue;
    const ordered = [...members].sort((a, b) => a.path.segment - b.path.segment);
    const color = ordered[0].path.color;
    if (ordered.some((stroke, index) => stroke.unmapped || !stroke.thin || stroke.path.segment !== index || !stroke.path.complete
      || stroke.path.paint !== 'stroke' || !/^[0-9a-f]{6}$/i.test(color || '') || stroke.path.color !== color || !point(stroke.path.from) || !point(stroke.path.to)
      || index && !near(ordered[index - 1].path.to, stroke.path.from))) continue;
    const [a, b, c, d, e] = [ordered[0].path.from, ...ordered.map(stroke => stroke.path.to)];
    const height = c[1] - d[1];
    if (!(height > 2 && height < 200) || ![a, b, c, d].every((p, index) => [b, c, d, e][index][0] > p[0])
      || !(d[1] < b[1] && b[1] < a[1] && a[1] < c[1]) || Math.abs(e[1] - d[1]) > Math.max(.15, height * .02)
      || (a[1] - b[1]) > height * .35 || (c[1] - b[1]) < height * .2 || (c[1] - b[1]) > height * .65
      || (c[0] - a[0]) < height * .12 || (c[0] - a[0]) > height * .65
      || (d[0] - c[0]) < height * .12 || (d[0] - c[0]) > height * .8 || (e[0] - d[0]) < height * .25) continue;
    result.push({ strokes: ordered, strokeIds: ordered.map(stroke => stroke.id), rect: union(ordered.map(stroke => stroke.rect)),
      start: a, valley: c, barStart: d, barEnd: e, height });
  }
  return result;
}
