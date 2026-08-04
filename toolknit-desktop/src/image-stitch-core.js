export const IMAGE_STITCH_LIMITS = Object.freeze({
  minFiles: 2,
  maxFiles: 100,
  maxSpacingPx: 500,
  minScalePercent: 10,
  maxScalePercent: 100,
  maxSide: 65_535,
  maxPixels: 160_000_000
});

export class ImageStitchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageStitchError';
    this.code = code;
  }
}

function normalizeInteger(value, fallback) {
  return Number(value ?? fallback);
}

export function normalizeImageStitchRequest(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImageStitchError('invalid_request', 'Stitch settings are required.');
  }

  const mode = value.mode ?? 'vertical';
  const reference = value.reference ?? 'first';
  const spacing_px = normalizeInteger(value.spacing_px, 0);
  const scale_percent = normalizeInteger(value.scale_percent, 100);
  const format = String(value.format ?? 'png').toLowerCase();
  const jpeg_quality = normalizeInteger(value.jpeg_quality, 92);
  const background_rgba = String(value.background_rgba ?? '#FFFFFFFF').toUpperCase();
  const requestedOutputName = value.output_name == null ? '' : String(value.output_name).trim();
  const output_name = requestedOutputName || null;
  const reservedOutputName = output_name?.split('.')[0].trimEnd().toUpperCase() || '';
  const validOutputName = output_name == null || (
    output_name.length <= 96
    && output_name !== '.'
    && output_name !== '..'
    && !/[\\/:*?"<>|\u0000-\u001f]/.test(output_name)
    && !/[ .]$/.test(output_name)
    && !['CON', 'PRN', 'AUX', 'NUL'].includes(reservedOutputName)
    && !/^(?:COM|LPT)[1-9]$/.test(reservedOutputName)
  );

  const valid = ['vertical', 'horizontal'].includes(mode)
    && ['first', 'smallest', 'largest'].includes(reference)
    && Number.isInteger(spacing_px)
    && spacing_px >= 0
    && spacing_px <= IMAGE_STITCH_LIMITS.maxSpacingPx
    && Number.isInteger(scale_percent)
    && scale_percent >= IMAGE_STITCH_LIMITS.minScalePercent
    && scale_percent <= IMAGE_STITCH_LIMITS.maxScalePercent
    && ['png', 'jpg'].includes(format)
    && Number.isInteger(jpeg_quality)
    && jpeg_quality >= 60
    && jpeg_quality <= 100
    && /^#[0-9A-F]{8}$/.test(background_rgba)
    && validOutputName;

  if (!valid) throw new ImageStitchError('invalid_request', 'Invalid stitch settings.');
  return { mode, reference, spacing_px, scale_percent, format, jpeg_quality, background_rgba, output_name };
}

export function calculateImageStitchLayout(images, rawSettings = {}) {
  if (!Array.isArray(images)
    || images.length < IMAGE_STITCH_LIMITS.minFiles
    || images.length > IMAGE_STITCH_LIMITS.maxFiles) {
    throw new ImageStitchError('invalid_images', 'Select 2 to 100 images.');
  }

  const settings = normalizeImageStitchRequest(rawSettings);
  const normalized = images.map((image, index) => {
    const width = Number(image?.width);
    const height = Number(image?.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new ImageStitchError('invalid_images', `Invalid dimensions at position ${index + 1}.`);
    }
    return { ...image, width, height };
  });

  const axis = settings.mode === 'vertical' ? 'width' : 'height';
  const referenceImage = settings.reference === 'first'
    ? normalized[0]
    : normalized.reduce((chosen, image) => {
      if (settings.reference === 'smallest') return image[axis] < chosen[axis] ? image : chosen;
      return image[axis] > chosen[axis] ? image : chosen;
    });
  const fixed = Math.max(1, Math.round(referenceImage[axis] * settings.scale_percent / 100));
  const items = normalized.map((image) => settings.mode === 'vertical'
    ? { ...image, target_width: fixed, target_height: Math.max(1, Math.round(image.height * fixed / image.width)) }
    : { ...image, target_height: fixed, target_width: Math.max(1, Math.round(image.width * fixed / image.height)) });
  const gapPixels = settings.spacing_px * (items.length - 1);
  const width = settings.mode === 'vertical'
    ? fixed
    : items.reduce((sum, item) => sum + item.target_width, 0) + gapPixels;
  const height = settings.mode === 'vertical'
    ? items.reduce((sum, item) => sum + item.target_height, 0) + gapPixels
    : fixed;

  if (!Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width > IMAGE_STITCH_LIMITS.maxSide
    || height > IMAGE_STITCH_LIMITS.maxSide
    || width * height > IMAGE_STITCH_LIMITS.maxPixels) {
    throw new ImageStitchError('output_too_large', 'The stitched image exceeds the current safe export limit. Reduce scale or remove images.');
  }
  return { ...settings, width, height, pixels: width * height, items };
}
