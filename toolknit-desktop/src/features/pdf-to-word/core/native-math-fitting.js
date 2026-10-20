// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
// Align verified radical geometry, sharing a fraction axis when one exists. The
// source's horizontal rule and sign bottom have different painted lengths, so
// their geometric errors are weighted by those lengths, never by page whitespace.
export function fitNativeMathGeometry({ size, baseline, targets, fractionCenters, measure }) {
  if (!Number.isFinite(size) || size < .5 || size > 400 || !Number.isFinite(baseline)
    || !Array.isArray(targets) || targets.length < 1 || targets.length > 8
    || !Array.isArray(fractionCenters) || fractionCenters.length > 8
    || !fractionCenters.every(Number.isFinite) || typeof measure !== 'function') return null;
  if (Math.max(...fractionCenters) - Math.min(...fractionCenters) > .5) return null;
  if (!targets.every(target => target && ['ruleY', 'ruleWidth', 'bottom', 'signWidth', 'height'].every(key => Number.isFinite(target[key]))
    && target.ruleWidth > 0 && target.signWidth > 0 && target.height > 0 && target.bottom > target.ruleY)) return null;
  const initial = measure(size, baseline);
  const valid = values => Array.isArray(values) && values.length === targets.length && values.every(value => value
    && ['ruleY', 'bottom', 'height'].every(key => Number.isFinite(value[key])) && value.height > 0);
  if (!valid(initial)) return null;
  const cost = values => values.reduce((total, value, index) => {
    const target = targets[index];
    return total + Math.abs(value.ruleY - target.ruleY) * target.ruleWidth
      + Math.abs(value.bottom - target.bottom) * target.signWidth;
  }, 0);
  const estimates = targets.map((target, index) => size * target.height / initial[index].height).sort((a, b) => a - b);
  const middle = estimates[Math.floor(estimates.length / 2)], center = Math.round(middle * 2) / 2;
  const candidates = [...new Set([size, ...Array.from({ length: 9 }, (_, index) => center + (index - 4) / 2)])]
    .filter(value => value >= .5 && value <= 400);
  const bars = [...fractionCenters].sort((a, b) => a - b), axis = bars[Math.floor(bars.length / 2)];
  let best = { size, baseline, cost: cost(initial) }, changed = false;
  for (const candidate of candidates) {
    // Cambria Math's axisHeight is 585/2048 em, also used by the static model.
    let nextBaseline = fractionCenters.length ? axis + candidate * 585 / 2048 : baseline;
    let values = measure(candidate, nextBaseline);
    if (!valid(values)) continue;
    if (!fractionCenters.length) {
      const shifts = targets.flatMap((target, index) => [
        { delta: target.ruleY - values[index].ruleY, weight: target.ruleWidth },
        { delta: target.bottom - values[index].bottom, weight: target.signWidth }
      ]).sort((a, b) => a.delta - b.delta);
      const halfway = shifts.reduce((sum, item) => sum + item.weight, 0) / 2;
      let total = 0, delta = 0;
      for (const item of shifts) { total += item.weight; if (total >= halfway) { delta = item.delta; break; } }
      nextBaseline += delta;
      values = values.map(value => ({ ...value, ruleY: value.ruleY + delta, bottom: value.bottom + delta }));
    }
    if (!valid(values)) continue;
    const nextCost = cost(values);
    if (nextCost + .01 < best.cost) { best = { size: candidate, baseline: nextBaseline, cost: nextCost }; changed = true; }
  }
  return changed ? best : null;
}

/** Fit all nested fraction rules together; a single main axis must be proven.
 * Visible glyph sizes are independent of the structural size selected here.
 */
export function fitNativeFractionGeometry({ size, baseline, targets, fractionCenters, measure }) {
  if (!Number.isFinite(size) || size < .5 || size > 400 || !Number.isFinite(baseline)
    || !Array.isArray(targets) || targets.length < 2 || targets.length > 32
    || !Array.isArray(fractionCenters) || !fractionCenters.length || fractionCenters.length > 8
    || !fractionCenters.every(Number.isFinite) || typeof measure !== 'function'
    || Math.max(...fractionCenters) - Math.min(...fractionCenters) > .5) return null;
  if (!targets.every(target => target && Number.isFinite(target.ruleY) && Number.isFinite(target.width) && target.width > 0)) return null;
  const valid = values => Array.isArray(values) && values.length === targets.length && values.every(Number.isFinite);
  const initial = measure(size, baseline); if (!valid(initial)) return null;
  const sorted = [...fractionCenters].sort((a, b) => a - b), axis = sorted[Math.floor(sorted.length / 2)];
  const currentAxis = baseline - size * 585 / 2048;
  const estimates = targets.flatMap((target, index) => {
    const sourceDistance = target.ruleY - axis, currentDistance = initial[index] - currentAxis;
    return Math.abs(sourceDistance) > 1 && Math.abs(currentDistance) > 1 && sourceDistance * currentDistance > 0
      ? [size * sourceDistance / currentDistance] : [];
  }).filter(Number.isFinite).sort((a, b) => a - b);
  if (!estimates.length) return null;
  const center = Math.round(estimates[Math.floor(estimates.length / 2)] * 2) / 2;
  const candidates = [...new Set([size, ...Array.from({ length: 9 }, (_, index) => center + (index - 4) / 2)])]
    .filter(value => value >= .5 && value <= 400);
  const cost = values => values.reduce((total, value, index) => total + Math.abs(value - targets[index].ruleY) * targets[index].width, 0);
  let best = { size, baseline, cost: cost(initial) }, changed = false;
  for (const candidate of candidates) {
    const nextBaseline = axis + candidate * 585 / 2048, values = measure(candidate, nextBaseline);
    if (!valid(values) || values.some((value, index) => Math.abs(initial[index] - targets[index].ruleY) <= .5
      && Math.abs(value - targets[index].ruleY) > .75)) continue;
    const nextCost = cost(values);
    if (nextCost + .01 < best.cost) { best = { size: candidate, baseline: nextBaseline, cost: nextCost }; changed = true; }
  }
  return changed ? best : null;
}
