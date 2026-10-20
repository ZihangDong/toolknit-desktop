// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { LIMITS, wordError } from './core/input.js';

export function createWordWorker() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let sequence = 0, disposed = false;
  const pending = new Map();
  function dispose(code = 'cancelled') {
    if (disposed) return;
    disposed = true; worker.terminate();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(wordError(code)); }
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id); clearTimeout(item.timer);
    if (data.error) item.reject(wordError(data.error)); else item.resolve(data.result);
  };
  worker.onerror = () => dispose('worker'); worker.onmessageerror = () => dispose('worker');
  return { dispose, request(type, payload = {}, transfer = []) {
    if (disposed) return Promise.reject(wordError('cancelled'));
    return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => dispose('timeout'), LIMITS.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, type, ...payload }, transfer); } catch { dispose('worker'); }
    });
  } };
}
