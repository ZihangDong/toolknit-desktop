/** Keep the visible page intact until its replacement has finished rendering. */
export function renderPdfPreviewCanvas({ proxy, canvas, wrap, scale, isCurrent }) {
  const display = proxy.getViewport({ scale });
  const dpr = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(8000000 / (display.width * display.height)));
  const viewport = proxy.getViewport({ scale: scale * dpr });
  const buffer = document.createElement('canvas');
  buffer.width = Math.max(1, Math.round(viewport.width)); buffer.height = Math.max(1, Math.round(viewport.height));
  let task;
  try { task = proxy.render({ canvasContext: buffer.getContext('2d'), viewport }); }
  catch (error) { buffer.width = buffer.height = 0; throw error; }
  return {
    cancel: () => task.cancel(),
    promise: task.promise.then(() => {
      if (!isCurrent()) return;
      canvas.width = buffer.width; canvas.height = buffer.height;
      canvas.getContext('2d').drawImage(buffer, 0, 0);
      for (const element of [canvas, wrap]) {
        element.style.width = `${Math.round(display.width)}px`;
        element.style.height = `${Math.round(display.height)}px`;
      }
      wrap.hidden = false;
    }).finally(() => { buffer.width = buffer.height = 0; })
  };
}
