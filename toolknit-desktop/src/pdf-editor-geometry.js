function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Resize an axis-aligned PDF-space box from a handle.
 * PDF user space grows upward on the y axis, so north changes the top edge
 * and south changes the bottom edge. The opposite edge remains anchored.
 */
export function resizePdfBoxFromHandle(baseBox, handle, deltaX = 0, deltaY = 0, options = {}) {
  const source = baseBox || {};
  const minWidth = Math.max(0.01, finiteNumber(options.minWidth, 1));
  const minHeight = Math.max(0.01, finiteNumber(options.minHeight, 1));
  let left = finiteNumber(source.x);
  let bottom = finiteNumber(source.y);
  let right = left + Math.max(minWidth, finiteNumber(source.width, minWidth));
  let top = bottom + Math.max(minHeight, finiteNumber(source.height, minHeight));
  const dx = finiteNumber(deltaX);
  const dy = finiteNumber(deltaY);

  if (String(handle || '').includes('w')) left += dx;
  if (String(handle || '').includes('e')) right += dx;
  if (String(handle || '').includes('n')) top += dy;
  if (String(handle || '').includes('s')) bottom += dy;

  if (right - left < minWidth) {
    if (String(handle || '').includes('w') && !String(handle || '').includes('e')) left = right - minWidth;
    else right = left + minWidth;
  }
  if (top - bottom < minHeight) {
    if (String(handle || '').includes('s') && !String(handle || '').includes('n')) bottom = top - minHeight;
    else top = bottom + minHeight;
  }

  const ratio = finiteNumber(options.aspectRatio);
  if (ratio > 0) {
    const horizontal = /[ew]/.test(handle);
    const vertical = /[ns]/.test(handle);
    let width = right - left;
    let height = top - bottom;
    if (horizontal && (!vertical || Math.abs(dx) >= Math.abs(dy * ratio))) height = width / ratio;
    else width = height * ratio;
    width = Math.max(minWidth, minHeight * ratio, width);
    height = width / ratio;
    left = /w/.test(handle) ? source.x + source.width - width
      : horizontal ? source.x : source.x + (source.width - width) / 2;
    bottom = /s/.test(handle) ? source.y + source.height - height
      : vertical ? source.y : source.y + (source.height - height) / 2;
    right = left + width;
    top = bottom + height;
  }

  return {
    x: left,
    y: bottom,
    width: Math.max(minWidth, right - left),
    height: Math.max(minHeight, top - bottom)
  };
}

export function rotatePdfDeltaToLocal(deltaX = 0, deltaY = 0, rotationDegrees = 0) {
  const radians = -(finiteNumber(rotationDegrees) * Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = finiteNumber(deltaX);
  const dy = finiteNumber(deltaY);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}
