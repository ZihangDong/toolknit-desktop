import assert from 'node:assert/strict';
import { selectPdfSplitRange } from '../src/features/pdf-split/selection.js';

const pages = Array.from({ length: 26 }, (_, index) => ({ fileIndex: index < 24 ? 0 : 1, pageIndex: index < 24 ? index + 1 : index - 23, selected: false }));
assert.deepEqual(selectPdfSplitRange(pages, '1-10'), { start: 1, end: 10, added: 10, selected: 10 });
assert.deepEqual(selectPdfSplitRange(pages, '15-20'), { start: 15, end: 20, added: 6, selected: 16 });
assert.deepEqual(pages.flatMap((page, index) => page.selected ? [index + 1] : []), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19, 20]);
assert.equal(selectPdfSplitRange(pages, '8-17').added, 4);
assert.equal(selectPdfSplitRange(pages, '15-20').added, 0);
pages[2].selected = false;
assert.equal(selectPdfSplitRange(pages, ' ２４ - ２６ ').added, 3);
assert.equal(pages[2].selected, false, 'A later range must preserve a manual deselection outside it.');
assert.deepEqual(pages.slice(-2).map(page => [page.fileIndex, page.pageIndex, page.selected]), [[1, 1, true], [1, 2, true]]);
assert.equal(selectPdfSplitRange(pages, '3').added, 1);
assert.equal(selectPdfSplitRange(pages, '21\u201422').added, 2);
for (const [input, code] of [['', 'rangeEmpty'], [' ', 'rangeEmpty'], ['0-2', 'rangeBounds'], ['1-27', 'rangeBounds'], ['26-15', 'rangeOrder'], ['5-0', 'rangeOrder'], ['1.5-3', 'rangeFormat'], ['1-3,5', 'rangeFormat'], ['1 2', 'rangeFormat'], ['-1', 'rangeFormat'], ['1e2', 'rangeFormat'], ['9007199254740993', 'rangeBounds'], ['<script>', 'rangeFormat']]) {
  const before = structuredClone(pages);
  assert.throws(() => selectPdfSplitRange(pages, input), error => error.code === code);
  assert.deepEqual(pages, before, 'Invalid input must leave the entire selection unchanged.');
}
assert.throws(() => selectPdfSplitRange([], '1'), error => error.code === 'rangeBounds');
console.log('PDF Split additive ranges passed: disjoint ranges, overlap, single pages, global multi-file numbering, manual selections and atomic validation.');
