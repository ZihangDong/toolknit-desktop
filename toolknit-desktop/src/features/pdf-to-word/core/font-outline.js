// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
const arity = { moveTo: 2, lineTo: 2, quadraticCurveTo: 4, bezierCurveTo: 6, closePath: 0 };

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
