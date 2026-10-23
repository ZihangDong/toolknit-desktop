/** Keep a newly placed image or shape inside the visible PDF crop box. */
export function fitInitialPdfPlacement(box, viewBox, padding = 0) {
  if (!Array.isArray(viewBox) || viewBox.length !== 4 || !viewBox.every(Number.isFinite)) return { ...box };
  const [left, bottom, right, top] = viewBox;
  if (right <= left || top <= bottom) return { ...box };
  const inset = Math.max(0, Math.min(padding, (right - left) / 4, (top - bottom) / 4));
  const availableWidth = right - left - inset * 2, availableHeight = top - bottom - inset * 2;
  const scale = Math.min(1, box.width > 0 ? availableWidth / box.width : 1, box.height > 0 ? availableHeight / box.height : 1);
  const width = box.width * scale, height = box.height * scale;
  return { x: Math.max(left + inset, Math.min(box.x, right - inset - width)),
    y: Math.max(bottom + inset, Math.min(box.y, top - inset - height)), width, height };
}
