export const AI_DOC_LIMITS = Object.freeze({
  maxPromptChars: 12000,
  maxHistoryMessages: 8,
  maxHistoryMessageChars: 4000,
  maxResponseChars: 100000,
  maxPages: 8,
  maxRegionsPerPage: 24,
  maxRegions: 160,
  maxRegionTextChars: 2000,
  maxTotalTextChars: 30000,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalImageBytes: 40 * 1024 * 1024,
  maxImagePixels: 36_000_000
});

export const AI_DOC_PAGE = Object.freeze({ width: 794, height: 1123 });

const ALLOWED_REGION_TYPES = new Set([
  'title',
  'subtitle',
  'section-heading',
  'sub-heading',
  'body',
  'body-indent',
  'list-item',
  'image',
  'signature',
  'date',
  'divider',
  'page-header',
  'page-footer',
  'table-row',
  'note',
  'emphasis'
]);

const ALLOWED_ALIGNMENTS = new Set(['left', 'center', 'right']);

const DEFAULT_FONT_SIZES = Object.freeze({
  title: 30,
  subtitle: 14,
  'section-heading': 18,
  'sub-heading': 15,
  body: 14.5,
  'body-indent': 14.5,
  'list-item': 13.5,
  signature: 13.5,
  date: 13.5,
  'page-header': 9,
  'page-footer': 9,
  'table-row': 13,
  note: 12.5,
  emphasis: 14
});

const MIN_FONT_SIZES = Object.freeze({
  title: 24,
  subtitle: 12,
  'section-heading': 15,
  'sub-heading': 13.5,
  body: 13,
  'body-indent': 13,
  'list-item': 12.5,
  signature: 12.5,
  date: 12.5,
  'page-header': 8,
  'page-footer': 8,
  'table-row': 12,
  note: 11.5,
  emphasis: 13
});

export class AiDocLayoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiDocLayoutError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, code, message) {
  if (!isPlainObject(value)) throw new AiDocLayoutError(code, message);
}

function clamp(value, min, max, fallback) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(min, Math.min(max, number)) * 100) / 100;
}

function cleanString(value, maxLength, fieldName) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new AiDocLayoutError('invalid_layout', `${fieldName} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new AiDocLayoutError(
      fieldName === 'Region text' ? 'region_text_too_large' : 'field_text_too_large',
      `${fieldName} exceeds its allowed length.`
    );
  }
  return value.replace(/\u0000/g, '').trim();
}

function normalizeRegion(region, pageIndex, regionIndex, totalTextState) {
  assertPlainObject(region, 'invalid_layout', `Region ${pageIndex + 1}.${regionIndex + 1} must be an object.`);
  if (!ALLOWED_REGION_TYPES.has(region.type)) {
    throw new AiDocLayoutError('invalid_layout', `Region ${pageIndex + 1}.${regionIndex + 1} uses an unsupported type.`);
  }

  const type = region.type;
  const x = clamp(region.x, 0, AI_DOC_PAGE.width - 30, 56);
  const y = clamp(region.y, 0, AI_DOC_PAGE.height - 2, 60);
  const w = clamp(region.w, 30, AI_DOC_PAGE.width - x, Math.min(682, AI_DOC_PAGE.width - x));
  const h = clamp(region.h, 2, AI_DOC_PAGE.height - y, type === 'divider' ? 2 : 40);
  const text = cleanString(region.text, AI_DOC_LIMITS.maxRegionTextChars, 'Region text');
  const label = cleanString(region.label, 300, 'Region label');
  const fontSize = clamp(
    region.fontSize,
    MIN_FONT_SIZES[type] || 12,
    32,
    DEFAULT_FONT_SIZES[type] || 14
  );

  totalTextState.count += text.length + label.length;
  if (totalTextState.count > AI_DOC_LIMITS.maxTotalTextChars) {
    throw new AiDocLayoutError('document_text_too_large', 'The document text exceeds the supported limit.');
  }

  const normalized = {
    type,
    x,
    y,
    w,
    h,
    text,
    fontSize,
    bold: Boolean(region.bold),
    align: ALLOWED_ALIGNMENTS.has(region.align) ? region.align : 'left'
  };

  if (type === 'image') normalized.label = label;
  return normalized;
}

/**
 * Converts model output into a bounded, serializable layout. Model-provided
 * image payloads are intentionally discarded; images may only enter through
 * the local upload flow after this boundary.
 */
export function normalizeAiDocLayout(value) {
  assertPlainObject(value, 'invalid_layout', 'AI response must be an object.');
  if (value.ready !== true) {
    throw new AiDocLayoutError('invalid_layout', 'AI response is not a completed document layout.');
  }
  if (!Array.isArray(value.pages) || value.pages.length === 0) {
    throw new AiDocLayoutError('invalid_layout', 'AI response does not contain document pages.');
  }
  if (value.pages.length > AI_DOC_LIMITS.maxPages) {
    throw new AiDocLayoutError('too_many_pages', 'The document contains too many pages.');
  }

  const totalTextState = { count: 0 };
  let regionCount = 0;
  const pages = value.pages.map((page, pageIndex) => {
    assertPlainObject(page, 'invalid_layout', `Page ${pageIndex + 1} must be an object.`);
    if (!Array.isArray(page.regions) || page.regions.length === 0) {
      throw new AiDocLayoutError('invalid_layout', `Page ${pageIndex + 1} does not contain regions.`);
    }
    if (page.regions.length > AI_DOC_LIMITS.maxRegionsPerPage) {
      throw new AiDocLayoutError('too_many_regions', `Page ${pageIndex + 1} contains too many regions.`);
    }
    regionCount += page.regions.length;
    if (regionCount > AI_DOC_LIMITS.maxRegions) {
      throw new AiDocLayoutError('too_many_regions', 'The document contains too many regions.');
    }
    return { regions: page.regions.map((region, regionIndex) => normalizeRegion(region, pageIndex, regionIndex, totalTextState)) };
  });

  return {
    ready: true,
    summary: cleanString(value.summary, 500, 'Document summary'),
    pages
  };
}

/** Creates an editable copy without JSON serialization or mutation of source state. */
export function cloneAiDocLayout(layout) {
  assertPlainObject(layout, 'invalid_layout', 'Document layout must be an object.');
  if (!Array.isArray(layout.pages)) {
    throw new AiDocLayoutError('invalid_layout', 'Document layout does not contain pages.');
  }
  return {
    ready: layout.ready === true,
    summary: typeof layout.summary === 'string' ? layout.summary : '',
    pages: layout.pages.map(page => ({
      regions: Array.isArray(page.regions) ? page.regions.map(region => ({ ...region })) : []
    }))
  };
}

/** Adds stable editor identities without changing the normalized document content. */
export function ensureAiDocEditorIds(layout, createId) {
  const editable = cloneAiDocLayout(layout);
  const makeId = typeof createId === 'function'
    ? createId
    : (() => `ai-doc-region-${Math.random().toString(36).slice(2, 10)}`);
  editable.pages.forEach(page => {
    page.regions.forEach(region => {
      if (typeof region.editorId !== 'string' || !region.editorId) {
        region.editorId = makeId();
      }
    });
  });
  return editable;
}

/** Swaps a content block with its previous or next content block on the same page. */
export function moveAiDocRegionInFlow(layout, editorId, direction) {
  if (direction !== -1 && direction !== 1) {
    throw new AiDocLayoutError('invalid_layout', 'Region move direction must be -1 or 1.');
  }
  const editable = cloneAiDocLayout(layout);
  for (const page of editable.pages) {
    const contentIndexes = page.regions
      .map((region, index) => ({ region, index }))
      .filter(({ region }) => !['page-header', 'page-footer'].includes(region.type));
    const contentIndex = contentIndexes.findIndex(({ region }) => region.editorId === editorId);
    if (contentIndex < 0) continue;
    const targetContentIndex = contentIndex + direction;
    if (targetContentIndex < 0 || targetContentIndex >= contentIndexes.length) {
      return { layout: editable, moved: false };
    }
    const sourceIndex = contentIndexes[contentIndex].index;
    const targetIndex = contentIndexes[targetContentIndex].index;
    [page.regions[sourceIndex], page.regions[targetIndex]] = [page.regions[targetIndex], page.regions[sourceIndex]];
    return { layout: editable, moved: true };
  }
  return { layout: editable, moved: false };
}

export function compactAiDocHistoryMessage(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, AI_DOC_LIMITS.maxHistoryMessageChars);
}

export function assertAiDocImageBudget(existingBytes, nextBytes) {
  if (!Number.isSafeInteger(existingBytes) || existingBytes < 0
    || !Number.isSafeInteger(nextBytes) || nextBytes < 0) {
    throw new AiDocLayoutError('invalid_image', 'Image size must be a non-negative integer.');
  }
  if (nextBytes > AI_DOC_LIMITS.maxImageBytes || existingBytes + nextBytes > AI_DOC_LIMITS.maxTotalImageBytes) {
    throw new AiDocLayoutError('images_too_large', 'The document image budget has been exceeded.');
  }
}

export function isSupportedAiDocImage(file) {
  if (!file) return false;
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (type === 'image/png' || type === 'image/jpeg') return true;
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  return /\.(png|jpe?g)$/.test(name);
}
