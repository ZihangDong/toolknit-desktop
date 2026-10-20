import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { comparePageInk } from './lib/pdf-word-fidelity.mjs';

const [sourcePath, renderedPath, reportPath] = process.argv.slice(2);
if (!sourcePath || !renderedPath || !reportPath) throw Error('Usage: check-pdf-word-browser-fidelity.mjs source.pdf rendered.pdf report.json');
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const files = new Map([
  ['/source.pdf', await readFile(sourcePath)], ['/target.pdf', await readFile(renderedPath)],
  ['/pdf.mjs', await readFile('node_modules/pdfjs-dist/build/pdf.mjs')],
  ['/pdf.worker.mjs', await readFile('node_modules/pdfjs-dist/build/pdf.worker.mjs')]
]);
const origin = 'http://127.0.0.1:14222', dpi = 288, errors = [], pages = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const rgba = async png => {
  const image = await loadImage(Buffer.from(png, 'base64')), canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  canvas.width = canvas.height = 0; return pixels;
};
try {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  // Every request is served from this process; private inputs never leave the machine.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), name = decodeURIComponent(url.pathname);
    if (url.origin !== origin || route.request().method() !== 'GET') return route.abort();
    if (name === '/') return route.fulfill({ body: '<!doctype html><title>Local PDF comparison</title>', contentType: 'text/html' });
    let body = files.get(name);
    if (!body && /^\/(cmaps|standard_fonts|wasm)\/[a-zA-Z0-9_.-]+$/.test(name)) body = await readFile(`node_modules/pdfjs-dist${name}`);
    if (!body) return route.abort();
    return route.fulfill({ body, contentType: name.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' });
  });
  await page.goto(`${origin}/`);
  const counts = await page.evaluate(async () => {
    const { getDocument, GlobalWorkerOptions } = await import('/pdf.mjs');
    GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
    window.scoreDocuments = []; window.scoreTasks = [];
    for (const url of ['/source.pdf', '/target.pdf']) {
      const task = getDocument({ url, cMapUrl: '/cmaps/', cMapPacked: true, standardFontDataUrl: '/standard_fonts/', wasmUrl: '/wasm/', verbosity: 0 });
      window.scoreTasks.push(task); window.scoreDocuments.push(await task.promise);
    }
    return window.scoreDocuments.map(document => document.numPages);
  });
  if (counts[0] === counts[1]) for (let n = 1; n <= counts[0]; n++) {
    const rendered = await page.evaluate(async ({ n, dpi }) => {
      const pdfPages = await Promise.all(window.scoreDocuments.map(document => document.getPage(n)));
      const sizes = pdfPages.map(page => page.getViewport({ scale: 1 }));
      try {
        if (Math.abs(sizes[0].width - sizes[1].width) > .2 || Math.abs(sizes[0].height - sizes[1].height) > .2) return { fault: 'page-size' };
        const width = Math.ceil(Math.max(...sizes.map(size => size.width)) * dpi / 72);
        const height = Math.ceil(Math.max(...sizes.map(size => size.height)) * dpi / 72), pngs = [];
        for (const pdfPage of pdfPages) {
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          try {
            await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: pdfPage.getViewport({ scale: dpi / 72 }), background: '#ffffff' }).promise;
            pngs.push(canvas.toDataURL('image/png').split(',')[1]);
          } finally { canvas.width = canvas.height = 0; }
        }
        return { width, height, pngs };
      } finally { pdfPages.forEach(page => page.cleanup()); }
    }, { n, dpi });
    pages.push(rendered.fault ? { page: n, fault: rendered.fault, f1: 0 }
      : { page: n, ...comparePageInk(await rgba(rendered.pngs[0]), await rgba(rendered.pngs[1]), rendered.width, rendered.height, { dpi }) });
  }
  if (errors.length) throw Error('Browser rendering errors occurred.');
  const scores = pages.map(page => page.f1), report = { metricVersion: 1, renderer: 'Edge PDF.js Canvas', mode: 'original-pages',
    sourcePages: counts[0], renderedPages: counts[1], pageCountMatches: counts[0] === counts[1], foregroundOnly: true, aligned: false, rescaled: false,
    mean: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    minimum: scores.length ? Math.min(...scores) : null,
    visualGate: pages.length === counts[0] && pages.every(page => page.f1 >= .95),
    contentSemanticsVerified: false, editabilityVerified: false, overallAccepted: false, pages };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  const { pages: details, ...summary } = report; console.log(JSON.stringify(summary, null, 2));
  await page.evaluate(async () => { for (const task of window.scoreTasks) await task.destroy(); });
  if (!report.visualGate) process.exitCode = 2;
} finally { await browser.close(); }
