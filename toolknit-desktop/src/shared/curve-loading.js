/*!
 * Adapted from Math Curve Loaders: https://github.com/tamia6/MathCurveLoaders
 * MIT License
 * Copyright (c) 2026 Tamia
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import curveData from './rose-curve.b64?raw';
import { createLifecycleScope } from '../app/tool-lifecycle.js';
import { createBackgroundFrameLimiter } from './animation-policy.js';
import { onLangChange } from '../i18n.js';

let points;
function curvePoints() {
  points ||= new Float32Array(Uint8Array.from(atob(curveData.trim()), c => c.charCodeAt(0)).buffer);
  return points;
}

export function startScanAnimation(canvas, quote, translate) {
  const scope = createLifecycleScope();
  const doc = canvas.ownerDocument, win = doc.defaultView, context = canvas.getContext('2d');
  const data = curvePoints(), reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const limiter = createBackgroundFrameLimiter({ windowRef: win, navigatorRef: win.navigator });
  let frame = 0, elapsed = 0, last = 0, width = 220, height = 220;
  let ink = '', base = '', quoteIndex = Math.floor(Math.random() * 5);
  const palette = () => { const css = win.getComputedStyle(canvas); ink = css.color; base = css.getPropertyValue('--dup-curve-base').trim(); };
  const resize = () => {
    const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const at = (progress, axis) => {
    const shape = (elapsed / 3.1 % 1) * 48, f0 = Math.floor(shape), f1 = (f0 + 1) % 48, mix = shape - f0;
    const p = Math.min(progress * 480, 479), p0 = Math.floor(p), p1 = Math.min(p0 + 1, 479), fraction = p - p0;
    const a = data[(f0 * 480 + p0) * 2 + axis], b = data[(f0 * 480 + p1) * 2 + axis];
    const c = data[(f1 * 480 + p0) * 2 + axis], d = data[(f1 * 480 + p1) * 2 + axis];
    return ((a + (b - a) * fraction) * (1 - mix) + (c + (d - c) * fraction) * mix) * Math.min(width, height) * .46 + (axis ? height : width) / 2;
  };
  function draw() {
    context.clearRect(0, 0, width, height);
    context.globalAlpha = 1; context.strokeStyle = base; context.lineWidth = 3.8 * Math.min(width, height) * .0092;
    context.lineCap = 'round'; context.beginPath();
    for (let i = 0; i < 480; i++) { const x = at(i / 480, 0), y = at(i / 480, 1); i ? context.lineTo(x, y) : context.moveTo(x, y); }
    context.stroke(); context.fillStyle = ink;
    const head = elapsed / 8 % 1;
    for (let i = 419; i >= 0; i--) {
      const offset = i / 419, position = head - offset * .17, wrapped = position - Math.floor(position), fade = (1 - offset) ** .56;
      context.globalAlpha = .04 + fade * .96;
      context.beginPath(); context.arc(at(wrapped, 0), at(wrapped, 1), (.9 + fade * 2.7) * Math.min(width, height) * .0092 * 1.35, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 1;
  }
  function tick(now) {
    frame = 0;
    if (scope.disposed || doc.hidden) return;
    if (last && !reduced.matches) elapsed += Math.min((now - last) / 1000, .1);
    last = now;
    if (limiter.shouldRender(now)) draw();
    if (!reduced.matches) frame = win.requestAnimationFrame(tick);
  }
  function restart() { if (frame) win.cancelAnimationFrame(frame); last = 0; if (!doc.hidden) frame = win.requestAnimationFrame(tick); }
  const observer = new win.ResizeObserver(() => { resize(); draw(); }); observer.observe(canvas);
  const theme = new win.MutationObserver(() => { palette(); draw(); }); theme.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  scope.use(() => { win.cancelAnimationFrame(frame); observer.disconnect(); theme.disconnect(); });
  scope.event(doc, 'visibilitychange', restart); scope.event(reduced, 'change', restart);
  quote.textContent = translate(`quote${quoteIndex}`);
  scope.use(onLangChange(() => { quote.textContent = translate(`quote${quoteIndex}`); }));
  scope.interval(() => {
    if (doc.hidden) return;
    quoteIndex = (quoteIndex + 1) % 5;
    quote.classList.add('is-changing');
    scope.timeout(() => { quote.textContent = translate(`quote${quoteIndex}`); quote.classList.remove('is-changing'); }, 250);
  }, 9000);
  palette(); resize(); draw(); restart();
  return () => scope.dispose();
}
