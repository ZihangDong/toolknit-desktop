import { createPreviewViewport } from '../../shared/preview-viewport.js';

export function createPdfCompressionResultList({
  root, translate, formatFileSize, errorMessage,
  canRetryCompact = () => false,
  onRetryCompact = () => {}
}) {
  const urls = new Set();
  const previews = new Set();
  const exactSize = value => Number.isSafeInteger(value) && value >= 0 ? `${formatFileSize(value)} (${value} B)` : '--';
  function clear() {
    previews.forEach(preview => preview.dispose()); previews.clear();
    urls.forEach(url => URL.revokeObjectURL(url));
    urls.clear();
    root?.replaceChildren();
  }
  const node = (tag, className, text = '') => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  function render(results) {
    clear();
    if (!root) return;
    for (const result of results) {
      const row = node('div', 'pdf-compress-result-row');
      const header = node('div', 'pdf-compress-result-heading');
      const status = node('span', 'pdf-compress-result-status', translate(`home.pdfCompress.status.${result.status}`));
      status.dataset.status = result.status;
      header.append(node('strong', '', result.name), status);
      row.append(header);
      const details = [];
      if (result.status === 'error') details.push(errorMessage(result.error, result));
      else {
        const size = result.status === 'target-not-reached' ? result.smallestSize : result.compressedSize;
        details.push(translate(result.mode === 'raster' ? 'home.pdfCompress.modeRaster' : 'home.pdfCompress.modeStructure'));
        details.push(translate('home.pdfCompress.sizeComparison', { original: exactSize(result.originalSize), output: exactSize(size) }));
        if (result.targetBytes != null) details.push(translate('home.pdfCompress.targetLimit', { size: exactSize(result.targetBytes) }));
        if (!result.outputPath) details.push(translate('home.pdfCompress.noOutputFile'));
      }
      if (result.compatibilityFallback) details.push(translate('home.pdfCompress.compatibilityEncoding'));
      row.append(node('p', 'pdf-compress-result-meta', details.join(' · ')));
      if (result.status === 'error' && canRetryCompact(result)) {
        const actions = node('div', 'pdf-compress-result-actions');
        const retry = node('button', 'pdf-compress-retry-compact', translate('home.pdfCompress.retryCompact'));
        retry.type = 'button';
        retry.addEventListener('click', () => onRetryCompact(result));
        actions.append(retry);
        row.append(actions);
      }
      if (result.attempts?.length || result.preview) {
        const detail = node('details', '');
        detail.append(node('summary', '', translate('home.pdfCompress.attemptDetails', { count: result.attempts?.length || 0 })));
        const table = node('table', '');
        const headings = node('tr', '');
        for (const key of ['attempt', 'resolution', 'jpegQuality', 'resultBytes']) headings.append(node('th', '', translate(`home.pdfCompress.${key}`)));
        table.append(headings);
        for (const attempt of result.attempts || []) {
          const tr = node('tr', '');
          for (const value of [attempt.attempt, attempt.scale == null ? '--' : `${Math.round(attempt.scale * 72)} DPI`,
            attempt.quality == null ? '--' : `${Math.round(attempt.quality * 100)}%`, exactSize(attempt.bytes)]) tr.append(node('td', '', String(value)));
          table.append(tr);
        }
        detail.append(table);
        if (result.preview) {
          const url = URL.createObjectURL(new Blob([result.preview], { type: 'image/jpeg' }));
          urls.add(url);
          detail.append(node('p', 'pdf-compress-result-meta', translate('home.pdfCompress.previewFirstPage')));
          const scroll = node('div', 'pdf-compress-preview');
          const image = document.createElement('img');
          image.src = url;
          image.alt = translate('home.pdfCompress.previewFirstPage');
          scroll.append(image);
          let scale = 1;
          const viewport = createPreviewViewport({ viewport: scroll, content: image,
            enabled: () => image.naturalWidth > 0 && detail.open,
            getScale: () => scale, setScale: value => { scale = value; image.style.width = image.naturalWidth * scale + 'px'; },
            min: .1, max: 4, panPrimary: () => true });
          previews.add(viewport);
          detail.append(scroll);
        }
        row.append(detail);
      }
      root.append(row);
    }
  }
  return { render, clear, dispose: clear };
}
