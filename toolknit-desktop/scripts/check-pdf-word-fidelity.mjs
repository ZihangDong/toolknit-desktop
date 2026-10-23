import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { comparePageInk } from './lib/pdf-word-fidelity.mjs';
import { parsePageRange } from '../src/features/pdf-to-word/core/input.js';

const [sourcePath, renderedPath, reportPath] = process.argv.slice(2);
const pageRange = process.argv.slice(5).find(argument => argument.startsWith('--pages='))?.slice(8);
if (!sourcePath || !renderedPath || !reportPath) throw Error('Usage: check-pdf-word-fidelity.mjs source.pdf rendered.pdf report.json');
const options = { verbosity: 0, cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/', wasmUrl: 'node_modules/pdfjs-dist/wasm/' };
const sourceTask = getDocument({ ...options, data: new Uint8Array(await readFile(sourcePath)) });
const targetTask = getDocument({ ...options, data: new Uint8Array(await readFile(renderedPath)) });
const dpi = 288, pages = [];
async function raster(page, width, height) {
  const canvas = createCanvas(width, height), context = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: dpi / 72 }), background: '#ffffff' }).promise;
  const result = context.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 0; page.cleanup(); return result;
}
try {
  const source = await sourceTask.promise, target = await targetTask.promise;
  const selectedPages = pageRange ? parsePageRange(pageRange, source.numPages) : Array.from({ length: source.numPages }, (_, index) => index + 1);
  if (selectedPages.length === target.numPages) {
    for (let n = 1; n <= selectedPages.length; n++) {
      const sourcePage = selectedPages[n - 1], a = await source.getPage(sourcePage), b = await target.getPage(n);
      const av = a.getViewport({ scale: 1 }), bv = b.getViewport({ scale: 1 });
      if (Math.abs(av.width - bv.width) > .2 || Math.abs(av.height - bv.height) > .2) {
        pages.push({ page: n, sourcePage, fault: 'page-size', f1: 0 }); a.cleanup(); b.cleanup(); continue;
      }
      const width = Math.ceil(Math.max(av.width, bv.width) * dpi / 72), height = Math.ceil(Math.max(av.height, bv.height) * dpi / 72);
      const original = await raster(a, width, height), rendered = await raster(b, width, height);
      pages.push({ page: n, sourcePage, ...comparePageInk(original, rendered, width, height, { dpi }) });
    }
  }
  const scores = pages.map(page => page.f1);
  const report = { metricVersion: 1, mode: 'original-pages', documentPages: source.numPages, selectedPages, sourcePages: selectedPages.length, renderedPages: target.numPages,
    pageCountMatches: selectedPages.length === target.numPages, foregroundOnly: true, aligned: false, rescaled: false,
    mean: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    minimum: scores.length ? Math.min(...scores) : null,
    visualGate: pages.length === selectedPages.length && pages.every(page => page.f1 >= .95),
    contentSemanticsVerified: false, editabilityVerified: false, overallAccepted: false, pages };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  const { pages: details, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
  if (!report.visualGate) process.exitCode = 2;
} finally { await sourceTask.destroy(); await targetTask.destroy(); }
