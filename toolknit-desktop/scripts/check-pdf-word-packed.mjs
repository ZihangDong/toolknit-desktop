import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { comparePageInk } from './lib/pdf-word-fidelity.mjs';
import { parsePageRange } from '../src/features/pdf-to-word/core/input.js';

const [sourcePath, renderedPath, metricsPath, reportPath] = process.argv.slice(2);
if (!reportPath) throw Error('Usage: check-pdf-word-packed.mjs source.pdf rendered.pdf metrics.json report.json');
const metrics = JSON.parse(await readFile(metricsPath, 'utf8'));
const mapping = metrics.quality.sourceMap;
const options = { verbosity: 0, cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/', wasmUrl: 'node_modules/pdfjs-dist/wasm/' };
const tasks = [];
const open = async path => { const task = getDocument({ ...options, data: new Uint8Array(await readFile(path)) }); tasks.push(task); return task.promise; };
const dpi = 288, ratio = dpi / 72, results = [];
try {
  const source = await open(sourcePath), target = await open(renderedPath);
  const selectedPages = metrics.pageRange ? parsePageRange(metrics.pageRange, source.numPages)
    : Array.from({ length: source.numPages }, (_, index) => index + 1);
  assert.deepEqual([...new Set(mapping.map(item => item.page))].sort((a, b) => a - b), selectedPages, 'every selected source page needs a placement');
  assert.equal(new Set(mapping.map(item => item.bookmark)).size, mapping.length, 'split source fragments have distinct bookmarks');
  for (const number of selectedPages) {
    const parts = mapping.filter(item => item.page === number).sort((a, b) => a.sourceRect.y - b.sourceRect.y);
    assert(parts.every((part, index) => !index || part.sourceRect.y >= parts[index - 1].sourceRect.y + parts[index - 1].sourceRect.height - .1),
      'multiple placements of one source page must not duplicate its visible bands');
  }
  assert.equal(Math.max(...mapping.map(item => item.targetPage)), target.numPages);
  for (let n = 1; n <= target.numPages; n++) {
    const page = await target.getPage(n), viewport = page.getViewport({ scale: ratio });
    assert(Math.abs(viewport.width / ratio - 595.3) < .2 && Math.abs(viewport.height / ratio - 841.9) < .2);
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    const reference = createCanvas(width, height), rendered = createCanvas(width, height);
    const context = reference.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    for (const placement of mapping.filter(item => item.targetPage === n)) {
      const original = await source.getPage(placement.page), { sourceRect, targetRect, scale } = placement;
      assert(scale > 0 && scale <= 1);
      if (placement.emptySourcePage) {
        const viewport = original.getViewport({ scale: ratio });
        assert(viewport.width * viewport.height <= 16_000_000);
        const blank = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), blankContext = blank.getContext('2d');
        await original.render({ canvas: blank, canvasContext: blankContext, viewport, background: '#ffffff' }).promise;
        const pixels = blankContext.getImageData(0, 0, blank.width, blank.height).data;
        let nonwhite = false;
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722 < 200) { nonwhite = true; break; }
        blank.width = blank.height = 0;
        assert(!nonwhite, 'a declared empty source page must actually have no visible foreground');
      }
      context.save(); context.beginPath();
      context.rect(targetRect.x * ratio, targetRect.y * ratio, targetRect.width * ratio, targetRect.height * ratio); context.clip();
      await original.render({ canvas: reference, canvasContext: context, viewport: original.getViewport({ scale: ratio * scale }),
        transform: [1, 0, 0, 1, (targetRect.x - sourceRect.x * scale) * ratio, (targetRect.y - sourceRect.y * scale) * ratio], background: 'rgba(255,255,255,0)' }).promise;
      context.restore(); original.cleanup();
    }
    const output = rendered.getContext('2d');
    await page.render({ canvas: rendered, canvasContext: output, viewport, background: '#ffffff' }).promise;
    results.push({ page: n, ...comparePageInk(context.getImageData(0, 0, width, height).data, output.getImageData(0, 0, width, height).data, width, height, { dpi }) });
    reference.width = reference.height = rendered.width = rendered.height = 0; page.cleanup();
  }
  const report = { metricVersion: 1, mode: 'packed-fragments', reference: 'original-pdf-at-declared-placements',
    documentPages: source.numPages, selectedPages, sourcePages: selectedPages.length, renderedPages: target.numPages, foregroundOnly: true, alignedToResult: false,
    mean: results.reduce((sum, result) => sum + result.f1, 0) / results.length,
    minimum: Math.min(...results.map(result => result.f1)), visualGate: results.every(result => result.f1 >= .95),
    contentSemanticsVerified: false, overallAccepted: false, pages: results };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  const { pages, ...summary } = report; console.log(JSON.stringify(summary, null, 2));
  if (!report.visualGate) process.exitCode = 2;
} finally { for (const task of tasks) await task.destroy(); }
