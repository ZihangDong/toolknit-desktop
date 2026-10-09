import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createTablePdf } from './fixtures/pdf-table-fixture.mjs';
import { extractPdfRules } from '../src/features/pdf-text-extract/table-grid.js';
import { reconstructPdfPage, convertPdfPagesToMarkdown } from '../src/features/pdf-text-extract/core.js';
import { createMarkdownRenderer } from '../src/features/markdown-editor/core.js';

const require = createRequire(import.meta.url);
const standardFontDataUrl = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/') + '/standard_fonts/';
for (const filled of [false, true]) {
  const task = getDocument({ data: await createTablePdf({ filled }), standardFontDataUrl });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let i=1; i<=pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const rules = extractPdfRules(await page.getOperatorList(), OPS);
      const content = await page.getTextContent();
      const result = reconstructPdfPage(content.items, { rules, pageNumber: i, pageWidth: 620, pageHeight: 800 });
      assert.equal(result.tables.length, 1, `page ${i}, filled=${filled}`);
      assert.equal(result.tables[0].columns, 5);
      assert.deepEqual(result.tables[0].rows[0], ['Date','Time','Course','Lecturer','Room']);
      assert.equal(result.tables[0].rows[1][2], 'First lesson\ncontinued in the same cell');
      assert.equal(result.tables[0].rows[1][1], '09:00\n10:00');
      assert.equal(result.tables[0].rows[1][0], result.tables[0].rows[2][0], 'vertical label must remain with both sessions');
      assert.equal(result.tables[0].rows[3][4], '');
      pages.push(result);
      page.cleanup();
    }
    const output = convertPdfPagesToMarkdown(pages, { sourceName: 'Schedule.pdf' });
    assert.match(output.markdown, /First lesson<br>continued in the same cell/);
    assert.match(output.markdown, /source-page: 2/);
    assert.equal(output.warnings.filter(item=>item.code==='merged-cells-flattened').length, 2);
    const html = createMarkdownRenderer().render(output.markdown);
    assert.equal((html.match(/<table>/g)||[]).length, 2);
    assert.ok(html.indexOf('Schedule') < html.indexOf('<table>'));
    assert.ok(html.indexOf('This paragraph') > html.indexOf('</table>'));
    assert.match(html, /&lt;tag&gt; a\|b \$5 \*literal\*/);
    assert.doesNotMatch(html, /<tag>|<math/);
  } finally { await task.destroy(); }
}

const rules = extractPdfRules({ fnArray: [OPS.save,OPS.transform,OPS.constructPath,OPS.restore],
  argsArray: [[],[2,0,0,2,10,20],[OPS.stroke,[new Float32Array([0,0,0,1,20,0])],[0,0,20,0]],[]] }, OPS);
assert.deepEqual(rules, [{ axis: 'h', at: 20, from: 10, to: 50 }]);
assert.deepEqual(extractPdfRules({ fnArray:[OPS.constructPath], argsArray:[[OPS.clip,[new Float32Array([0,0,0,1,20,0])]]] }, OPS), []);
console.log('PDF.js table regression passed: stroked/filled rules, merged labels, multiline/empty cells, pages, literal symbols.');

const continuationTask = getDocument({ data: await createTablePdf({ continuation: true }), standardFontDataUrl });
try {
  const pdf = await continuationTask.promise;
  const pages = [];
  for (let i=1; i<=2; i++) {
    const page = await pdf.getPage(i);
    pages.push(reconstructPdfPage((await page.getTextContent()).items, { pageNumber:i, pageWidth:620, pageHeight:800,
      rules:extractPdfRules(await page.getOperatorList(), OPS) }));
    page.cleanup();
  }
  const markdown = convertPdfPagesToMarkdown(pages).markdown;
  assert.equal((markdown.match(/\| Date \| Time \| Course \| Lecturer \| Room \|/g)||[]).length, 2);
  assert.match(markdown, /\| Day 2 \| 08:30 \| Continued session \| Dora \| Hall 3 \|/);
  const differentGrid = structuredClone(pages[1]);
  differentGrid.tables[0].xs[1] += 10;
  assert.equal((convertPdfPagesToMarkdown([pages[0], differentGrid]).markdown.match(/\| Date \| Time/g)||[]).length, 1);
  console.log('Continuation headers preserve first data row; different grids remain independent.');
} finally { await continuationTask.destroy(); }
