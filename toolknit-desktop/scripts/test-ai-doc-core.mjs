import assert from 'node:assert/strict';
import {
  AI_DOC_LIMITS,
  AiDocLayoutError,
  assertAiDocImageBudget,
  cloneAiDocLayout,
  compactAiDocHistoryMessage,
  ensureAiDocEditorIds,
  isSupportedAiDocImage,
  moveAiDocRegionInFlow,
  normalizeAiDocLayout
} from '../src/ai-doc-core.js';

const validLayout = {
  ready: true,
  summary: 'A safe sample document',
  pages: [{
    regions: [
      { type: 'title', x: -99, y: 60, w: 1000, h: 50, text: 'Title', fontSize: 99, bold: true, align: 'center' },
      { type: 'body', x: 56, y: 130, w: 682, h: 60, text: 'Body content', fontSize: 11.5, align: 'left' },
      { type: 'image', x: 56, y: 210, w: 200, h: 120, label: 'Cover image', imageData: 'data:image/png;base64,not-allowed' }
    ]
  }]
};

const normalized = normalizeAiDocLayout(validLayout);
assert.equal(normalized.pages[0].regions[0].x, 0);
assert.equal(normalized.pages[0].regions[0].w, 794);
assert.equal(normalized.pages[0].regions[0].fontSize, 32);
assert.equal(normalized.pages[0].regions[1].fontSize, 13);
assert.equal(normalized.pages[0].regions[2].imageData, undefined);
assert.equal(normalized.pages[0].regions[2].label, 'Cover image');

const editable = cloneAiDocLayout(normalized);
editable.pages[0].regions[0].text = 'Changed title';
assert.equal(normalized.pages[0].regions[0].text, 'Title');

let nextEditorId = 0;
const editorLayout = ensureAiDocEditorIds(normalized, () => `region-${++nextEditorId}`);
assert.equal(editorLayout.pages[0].regions.every(region => Boolean(region.editorId)), true);
const movedLayout = moveAiDocRegionInFlow(editorLayout, editorLayout.pages[0].regions[1].editorId, -1);
assert.equal(movedLayout.moved, true);
assert.equal(movedLayout.layout.pages[0].regions[0].text, 'Body content');
assert.equal(editorLayout.pages[0].regions[0].text, 'Title');

assert.throws(
  () => normalizeAiDocLayout({ ...validLayout, pages: Array(AI_DOC_LIMITS.maxPages + 1).fill(validLayout.pages[0]) }),
  error => error instanceof AiDocLayoutError && error.code === 'too_many_pages'
);
assert.throws(
  () => normalizeAiDocLayout({ ...validLayout, pages: [{ regions: Array(AI_DOC_LIMITS.maxRegionsPerPage + 1).fill(validLayout.pages[0].regions[0]) }] }),
  error => error instanceof AiDocLayoutError && error.code === 'too_many_regions'
);
assert.throws(
  () => normalizeAiDocLayout({ ...validLayout, pages: [{ regions: [{ ...validLayout.pages[0].regions[0], type: 'script' }] }] }),
  error => error instanceof AiDocLayoutError && error.code === 'invalid_layout'
);
assert.throws(
  () => normalizeAiDocLayout({ ...validLayout, pages: [{ regions: [{ ...validLayout.pages[0].regions[0], text: 'x'.repeat(AI_DOC_LIMITS.maxRegionTextChars + 1) }] }] }),
  error => error instanceof AiDocLayoutError && error.code === 'region_text_too_large'
);

assert.equal(compactAiDocHistoryMessage(` ${'x'.repeat(AI_DOC_LIMITS.maxHistoryMessageChars + 20)} `).length, AI_DOC_LIMITS.maxHistoryMessageChars);
assert.equal(isSupportedAiDocImage({ type: 'image/png', name: 'x.png' }), true);
assert.equal(isSupportedAiDocImage({ type: 'image/svg+xml', name: 'x.svg' }), false);
assert.equal(isSupportedAiDocImage({ type: '', name: 'photo.jpeg' }), true);
assert.doesNotThrow(() => assertAiDocImageBudget(AI_DOC_LIMITS.maxTotalImageBytes - 1, 1));
assert.throws(
  () => assertAiDocImageBudget(AI_DOC_LIMITS.maxTotalImageBytes, 1),
  error => error instanceof AiDocLayoutError && error.code === 'images_too_large'
);

console.log('AI document core regression checks passed');
