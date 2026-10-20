import assert from 'node:assert/strict';

function mask(rgba, width, height, threshold) {
  assert.equal(rgba.length, width * height * 4);
  const result = new Uint8Array(width * height);
  for (let i = 0; i < result.length; i++) {
    const offset = i * 4, alpha = rgba[offset + 3] / 255;
    const light = (rgba[offset] * .2126 + rgba[offset + 1] * .7152 + rgba[offset + 2] * .0722) * alpha + 255 * (1 - alpha);
    result[i] = light < threshold ? 1 : 0;
  }
  return result;
}

function dilate(input, width, height, radius) {
  const horizontal = new Uint8Array(input.length), output = new Uint8Array(input.length);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = -radius; x < width; x++) {
      if (x + radius < width) count += input[y * width + x + radius];
      if (x - radius - 1 >= 0) count -= input[y * width + x - radius - 1];
      if (x >= 0) horizontal[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = -radius; y < height; y++) {
      if (y + radius < height) count += horizontal[(y + radius) * width + x];
      if (y - radius - 1 >= 0) count -= horizontal[(y - radius - 1) * width + x];
      if (y >= 0) output[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  return output;
}

/** Foreground precision/recall; white margins contribute no matching pixels.
 * Input must use identical physical page coordinates and DPI, without alignment.
 * This score alone proves neither editable content nor mathematical semantics.
 */
export function comparePageInk(sourceRgba, targetRgba, width, height, { dpi = 144, tolerancePt = .75, threshold = 200 } = {}) {
  assert(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0);
  assert(Number.isFinite(dpi) && dpi >= 72 && dpi <= 600);
  assert(Number.isFinite(tolerancePt) && tolerancePt >= 0 && tolerancePt <= 1);
  assert(Number.isFinite(threshold) && threshold > 0 && threshold < 255);
  const source = mask(sourceRgba, width, height, threshold), target = mask(targetRgba, width, height, threshold);
  const radius = Math.floor(tolerancePt * dpi / 72);
  const sourceNear = dilate(source, width, height, radius), targetNear = dilate(target, width, height, radius);
  let sourceInk = 0, targetInk = 0, matchedSource = 0, matchedTarget = 0;
  for (let i = 0; i < source.length; i++) {
    sourceInk += source[i]; targetInk += target[i];
    matchedSource += source[i] && targetNear[i] ? 1 : 0;
    matchedTarget += target[i] && sourceNear[i] ? 1 : 0;
  }
  const recall = sourceInk ? matchedSource / sourceInk : targetInk ? 0 : 1;
  const precision = targetInk ? matchedTarget / targetInk : sourceInk ? 0 : 1;
  return { sourceInk, targetInk, matchedSource, matchedTarget, recall, precision,
    f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    dpi, tolerancePt, radius, threshold };
}
