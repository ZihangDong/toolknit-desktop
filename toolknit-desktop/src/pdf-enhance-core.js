export const PDF_ENHANCE_LIMITS = Object.freeze({
  maxInputBytes: 50 * 1024 * 1024,
  maxPages: 100,
  maxRenderPixelsPerPage: 8_000_000,
  maxTotalRenderPixels: 60_000_000,
  maxRenderDimension: 8_192,
  maxOutputBytes: 100 * 1024 * 1024
});

export const PDF_ENHANCE_STRENGTHS = new Set(['light', 'medium', 'strong']);

function enhanceError(code) {
  return new Error(`pdf-enhance:${code}`);
}

export function assertPdfEnhanceSelection(files, limits = PDF_ENHANCE_LIMITS) {
  if (!Array.isArray(files) || files.length !== 1) {
    throw enhanceError('single-file-required');
  }

  const file = files[0];
  if (!/\.pdf$/i.test(String(file?.name || ''))) {
    throw enhanceError('invalid-pdf');
  }

  const size = Number(file?.size);
  if (!Number.isSafeInteger(size) || size < 1) {
    throw enhanceError('invalid-pdf');
  }
  if (size > limits.maxInputBytes) {
    throw enhanceError('input-too-large');
  }
}

export function assertPdfEnhanceStrength(strength) {
  if (!PDF_ENHANCE_STRENGTHS.has(strength)) {
    throw enhanceError('invalid-strength');
  }
}

export function assertPdfEnhancePagePlan(pages, limits = PDF_ENHANCE_LIMITS) {
  if (!Array.isArray(pages) || pages.length < 1) {
    throw enhanceError('invalid-pdf');
  }
  if (pages.length > limits.maxPages) {
    throw enhanceError('too-many-pages');
  }

  let totalPixels = 0;
  for (const page of pages) {
    const outputWidth = Number(page?.outputWidth);
    const outputHeight = Number(page?.outputHeight);
    const width = Math.ceil(Number(page?.renderWidth));
    const height = Math.ceil(Number(page?.renderHeight));
    if (!Number.isFinite(outputWidth) || !Number.isFinite(outputHeight) || outputWidth <= 0 || outputHeight <= 0
      || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw enhanceError('invalid-pdf');
    }
    if (width > limits.maxRenderDimension || height > limits.maxRenderDimension) {
      throw enhanceError('page-too-large');
    }

    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > limits.maxRenderPixelsPerPage) {
      throw enhanceError('page-too-large');
    }
    totalPixels += pixels;
    if (!Number.isSafeInteger(totalPixels) || totalPixels > limits.maxTotalRenderPixels) {
      throw enhanceError('document-too-large');
    }
  }

  return { totalPixels };
}

export function getPdfEnhanceErrorCode(error) {
  const explicitCode = String(error?.message || error || '').match(/pdf-enhance:([a-z-]+)/i);
  if (explicitCode) return explicitCode[1].toLowerCase();

  const details = String(error?.message || error || '').toLowerCase();
  if (details.includes('password')) return 'password-protected';
  if (details.includes('invalid pdf') || details.includes('pdf header') || details.includes('malformed')) return 'invalid-pdf';
  return 'enhancement-failed';
}
