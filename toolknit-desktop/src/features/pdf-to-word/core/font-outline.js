// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
const arity = { moveTo: 2, lineTo: 2, quadraticCurveTo: 4, bezierCurveTo: 6, closePath: 0 };

/** Bounds of the actual glyph stroke in font units. Round/bevel strokes stay
 * within the outline plus half the pen width; miters and square caps need
 * their own endpoint geometry. Never expand every glyph by the miter limit. */
export function glyphStrokeBounds(outline, { width, lineJoin = 0, lineCap = 0, miterLimit = 10 }) {
  if (!Number.isFinite(width) || width <= 0 || ![0, 1, 2].includes(lineJoin)
    || ![0, 1, 2].includes(lineCap) || !Number.isFinite(miterLimit) || miterLimit < 1) return null;
  const radius = width / 2, original = outline.bbox;
  const expanded = amount => ({ minX: original.minX - amount, minY: original.minY - amount,
    maxX: original.maxX + amount, maxY: original.maxY + amount });
  const result = expanded(radius), commands = outline.path?.commands;
  const conservative = () => expanded(radius * Math.max(lineJoin === 0 ? miterLimit : 1, lineCap === 2 ? Math.SQRT2 : 1));
  if (!Array.isArray(commands) || commands.length > 4096) return conservative();
  const include = (x, y) => {
    result.minX = Math.min(result.minX, x); result.minY = Math.min(result.minY, y);
    result.maxX = Math.max(result.maxX, x); result.maxY = Math.max(result.maxY, y);
  };
  const direction = (from, candidates) => {
    for (const to of candidates) {
      const x = to[0] - from[0], y = to[1] - from[1], length = Math.hypot(x, y);
      if (length > 1e-10) return [x / length, y / length];
    }
    return null;
  };
  const join = (at, incoming, outgoing) => {
    if (lineJoin !== 0) return;
    const denominator = 1 + incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
    if (denominator <= 1e-10) return; // A reversal exceeds any finite miter limit.
    const dx = -(incoming[1] + outgoing[1]) * radius / denominator;
    const dy = (incoming[0] + outgoing[0]) * radius / denominator;
    if (Math.hypot(dx, dy) > radius * miterLimit + 1e-8) return;
    include(at[0] + dx, at[1] + dy); include(at[0] - dx, at[1] - dy);
  };
  const cap = (at, tangent, sign) => {
    if (lineCap !== 2) return;
    const x = at[0] + sign * tangent[0] * radius, y = at[1] + sign * tangent[1] * radius;
    include(x - tangent[1] * radius, y + tangent[0] * radius);
    include(x + tangent[1] * radius, y - tangent[0] * radius);
  };
  let cursor = null, start = null, first = null, previous = null;
  const finish = closed => {
    if (first && previous) {
      if (closed) join(start, previous, first);
      else { cap(start, first, -1); cap(cursor, previous, 1); }
    }
    first = previous = null;
  };
  const segment = (end, controls = []) => {
    const outgoing = direction(cursor, [...controls, end]);
    const backwards = direction(end, [...controls].reverse().concat([cursor]));
    if (outgoing && backwards) {
      if (previous) join(cursor, previous, outgoing);
      first ||= outgoing; previous = [-backwards[0], -backwards[1]];
    }
    cursor = end;
  };
  for (const command of commands) {
    if (!command || !Object.hasOwn(arity, command.command) || !Array.isArray(command.args)
      || command.args.length !== arity[command.command]
      || !command.args.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) return conservative();
    const { args } = command;
    if (command.command === 'moveTo') { finish(false); cursor = start = [...args]; }
    else if (!cursor) return conservative();
    else if (command.command === 'closePath') { segment(start); finish(true); cursor = null; }
    else if (command.command === 'lineTo') segment([...args]);
    else if (command.command === 'quadraticCurveTo') segment(args.slice(2), [args.slice(0, 2)]);
    else segment(args.slice(4), [args.slice(0, 2), args.slice(2, 4)]);
  }
  finish(false);
  return result;
}

/** A repaired CFF glyph may start with a move/close contour that paints
 * nothing but expands fontkit's bbox. Preserve all actual drawing segments. */
export function glyphInkBounds(outline, fillOnly = false) {
  const original = outline.bbox, path = outline.path;
  if (!fillOnly || !Array.isArray(path?.commands) || path.commands.length > 4096) return original;
  const retained = []; let contour = [], drawing = false, removed = false;
  const finish = () => {
    if (contour.length) {
      if (drawing) retained.push(...contour); else removed = true;
    }
    contour = []; drawing = false;
  };
  for (const command of path.commands) {
    if (!command || !Object.hasOwn(arity, command.command) || !Array.isArray(command.args)
      || command.args.length !== arity[command.command]
      || !command.args.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) return original;
    if (command.command === 'moveTo') { finish(); contour.push(command); }
    else if (command.command === 'closePath') { if (contour.length) contour.push(command); finish(); }
    else {
      if (!contour.length) return original;
      contour.push(command); drawing = true;
    }
  }
  finish();
  // Entirely empty or unrecognized outlines retain the existing conservative
  // metrics path. This refinement applies only to otherwise drawable glyphs.
  if (!removed || !retained.length || typeof path.mapPoints !== 'function') return original;
  const cleaned = path.mapPoints((x, y) => [x, y]);
  cleaned.commands = retained.map(({ command, args }) => ({ command, args: [...args] }));
  return cleaned.bbox;
}
