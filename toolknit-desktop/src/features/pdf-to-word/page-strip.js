// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { createPausableRenderQueue } from '../../shared/pdf-render-queue.js';

export function createWordPageStrip({ root, pdf, select, label }) {
  let disposed = false, paused = false;
  const nodes = new Map(), visible = new Set(), cache = new Map();
  const queue = createPausableRenderQueue({ concurrency: 1, run: async number => {
    if (disposed || paused || cache.has(number)) return;
    const entry = nodes.get(number); let task, untrack;
    try {
      const page = await pdf.getPage(number); if (disposed || paused) return;
      const viewport = page.getViewport({ scale: 150 / page.getViewport({ scale: 1 }).width });
      entry.button.style.setProperty('--page-ratio', String(viewport.width / viewport.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, background: '#fff' });
      untrack = queue.track(number, task); await task.promise;
      if (disposed || paused) return;
      entry.canvas.width = canvas.width; entry.canvas.height = canvas.height;
      entry.canvas.getContext('2d').drawImage(canvas, 0, 0); canvas.width = canvas.height = 0;
      cache.set(number, true);
      for (const key of cache.keys()) {
        if (cache.size <= 18) break;
        if (!visible.has(key)) { const old = nodes.get(key).canvas; old.width = old.height = 0; cache.delete(key); }
      }
    } catch { /* A failed thumbnail never blocks conversion; scrolling retries it. */ }
    finally { untrack?.(); }
  } });
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const number = Number(entry.target.dataset.page);
      if (entry.isIntersecting) { visible.add(number); queue.enqueue(number); } else visible.delete(number);
    }
  }, { root, rootMargin: '180px' });
  for (let number = 1; number <= pdf.numPages; number++) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'pdf-word-thumbnail'; button.dataset.page = String(number);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 0; canvas.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span'); caption.textContent = String(number);
    button.append(canvas, caption); button.setAttribute('aria-label', label(number)); root.append(button);
    nodes.set(number, { button, canvas }); observer.observe(button);
  }
  const click = event => { const button = event.target.closest('[data-page]'); if (button && !paused) select(Number(button.dataset.page)); };
  root.addEventListener('click', click);
  return {
    update(number, pages) {
      for (const [index, { button }] of nodes) {
        if (index === number) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        button.classList.toggle('is-outside', pages ? !pages.includes(index) : false);
        button.setAttribute('aria-label', label(index));
      }
      const button = nodes.get(number)?.button;
      if (button && (button.offsetTop < root.scrollTop || button.offsetTop + button.offsetHeight > root.scrollTop + root.clientHeight)) button.scrollIntoView({ block: 'nearest' });
    },
    pause() { paused = true; queue.pause(); },
    resume() { paused = false; queue.resume(); visible.forEach(number => queue.enqueue(number)); },
    dispose() { disposed = true; queue.dispose(); observer.disconnect(); root.removeEventListener('click', click); nodes.forEach(({ canvas }) => { canvas.width = canvas.height = 0; }); root.replaceChildren(); cache.clear(); }
  };
}
