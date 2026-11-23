import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

export async function pdfRemovalRenderQa(directory) {
  const root = path.resolve(directory), run = promisify(execFile);
  await mkdir(root, { recursive: true });
  const nativeChecksSkipped = process.platform !== 'win32' || Boolean(process.env.TOOLKNIT_REMOVE_SKIP_NATIVE);
  const poppler = process.env.TOOLKNIT_PDFTOPPM || 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt/dependencies/native/poppler/Library/bin/pdftoppm.exe';
  const qpdf = path.resolve('src-tauri/resources/qpdf/qpdf.exe'), rendered = new Set(), pdfjsCache = new Map();
  let pixelChecks = 0, pdfjsComparisons = 0, qpdfChecks = 0;
  let pdfjsDifferenceChecks = 0;
  async function save(name, bytes) {
    const file = path.join(root, name + '.pdf'); await writeFile(file, bytes); return file;
  }
  async function render(file) {
    if (rendered.has(file)) return;
    await run(poppler, ['-r', '96', '-png', file, file.slice(0, -4)], { windowsHide: true }); rendered.add(file);
  }
  async function pdfjsPixels(file, pages) {
    const key = JSON.stringify([file, pages]);
    if (pdfjsCache.has(key)) return pdfjsCache.get(key);
    const job = getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0, useSystemFonts: true });
    try {
      const document = await job.promise, pixels = [];
      for (let number = 1; number <= pages; number++) {
        const page = await document.getPage(number), viewport = page.getViewport({ scale: 96 / 72 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        pixels.push(Buffer.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
        page.cleanup();
      }
      pdfjsCache.set(key, pixels); return pixels;
    } finally { await job.destroy(); }
  }
  async function compare(actual, expected, pages, { allPdfjsPages = false } = {}) {
    if (nativeChecksSkipped) return;
    await render(actual); await render(expected);
    for (let page = 1; page <= pages; page++) {
      const a = await sharp(actual.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      const b = await sharp(expected.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      assert.ok(a.equals(b), `Poppler ${path.basename(actual)} page ${page}`); pixelChecks++;
    }
    const pageCount = allPdfjsPages ? pages : 1;
    const a = await pdfjsPixels(actual, pageCount), b = await pdfjsPixels(expected, pageCount);
    for (let i = 0; i < pageCount; i++) {
      assert.ok(a[i].equals(b[i]), `PDF.js ${path.basename(actual)} page ${i + 1}`); pdfjsComparisons++;
    }
  }
  async function verifyPdfjsDifference(actual, control, pages) {
    if (nativeChecksSkipped) return;
    const a = await pdfjsPixels(actual, pages), b = await pdfjsPixels(control, pages);
    for (let i = 0; i < pages; i++) {
      assert.ok(!a[i].equals(b[i]), `PDF.js did not distinguish ${path.basename(actual)} from ${path.basename(control)} on page ${i + 1}`);
      pdfjsDifferenceChecks++;
    }
  }
  async function verify(file) {
    if (nativeChecksSkipped) return;
    await run(qpdf, ['--check', file], { windowsHide: true }); qpdfChecks++;
  }
  return { root, save, compare, verify, verifyPdfjsDifference, report: () => ({ pixelChecks, pdfjsComparisons, qpdfChecks, nativeChecksSkipped,
    ...(pdfjsDifferenceChecks ? { pdfjsDifferenceChecks } : {}),
  }) };
}
