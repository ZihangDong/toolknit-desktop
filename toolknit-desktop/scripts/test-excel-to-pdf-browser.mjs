import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/excel-diagnosis/browser');
await mkdir(output, { recursive: true });
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, open: false },
  plugins: [{
    name: 'excel-test-platform', enforce: 'pre',
    load(id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/platform/tauri-runtime.js')) return;
      return `export const tauriCorePromise = Promise.resolve({invoke: (...args) => globalThis.excelQa.invoke(...args)});
        export const tauriEventPromise = Promise.resolve({listen: async (_, callback) => { globalThis.excelQa.progress = callback; return () => { globalThis.excelQa.progress = null; }; }});
        export const loadTauriDialog = async () => ({open: async () => ['C:/fixture.xls']});
        export const loadTauriWebview = async () => ({getCurrentWebview: () => ({onDragDropEvent: async () => () => {}})});`;
    },
    configureServer(server) {
      server.middlewares.use('/__excel-qa', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/tool-nav-unified.css"></head><body></body></html>');
      });
    }
  }]
});
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { colors: [], cases: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (/Blocked aria-hidden|Ensure that the cMapUrl|Error during font loading/.test(message.text())) report.errors.push(message.text());
  });
  await page.goto(`${url}__excel-qa`);
  await page.evaluate(async () => {
    localStorage.setItem('toolknit-lang', 'zh');
    globalThis.excelQa = {
      calls: [], notifications: [], gateCount: 0,
      async invoke(command, args) {
        if (command === 'get_install_config') return { language: 'zh' };
        this.calls.push({ command, args });
        if (command === 'convert_excel_to_pdf') return new Promise((resolve, reject) => {
          this.resolveConversion = resolve; this.rejectConversion = reject;
        });
      }
    };
    const { initExcelToPdfTool } = await import('/src/features/excel-to-pdf/tool.js');
    const root = document.createElement('section');
    root.className = 'feature-tool-overlay pdf-merge-v2 excel-to-pdf-overlay';
    root.id = 'excelToPdfOverlay';
    document.body.append(root);
    globalThis.excelQa.controller = initExcelToPdfTool({
      overlay: root, isTauri: true,
      notify: message => globalThis.excelQa.notifications.push(message),
      getOutputDir: async () => 'C:/output',
      ensureLibreOfficeAvailable: () => new Promise(resolve => {
        globalThis.excelQa.gateCount++;
        globalThis.excelQa.resolveGate = resolve;
      })
    });
    globalThis.excelQa.controller.open();
  });
  await page.locator('[data-excel-action="upload"]').first().click();
  await page.waitForSelector('.excel-pdf-file');
  const convert = page.locator('[data-excel-action="convert"]');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(350);
    const colors = await convert.evaluate(button => ({
      button: getComputedStyle(button).color, label: getComputedStyle(button.querySelector('span')).color,
      background: getComputedStyle(button).backgroundColor
    }));
    assert.equal(colors.label, colors.button);
    if (theme === 'light') assert.equal(colors.label, 'rgb(255, 255, 255)');
    assert.notEqual(colors.label, colors.background);
    report.colors.push({ theme, ...colors });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(output, 'light-ready.png') });
  await convert.click();
  assert.equal(await convert.isDisabled(), true);
  assert.equal(await page.locator('[data-excel-process]').evaluate(node => node.classList.contains('visible')), true);
  await convert.evaluate(node => node.click());
  assert.equal(await page.evaluate(() => excelQa.gateCount), 1);
  await page.locator('[data-excel-action="cancel"]').click();
  await page.evaluate(() => excelQa.resolveGate(true));
  await page.waitForFunction(() => !document.querySelector('[data-excel-action="convert"]').disabled);
  assert.deepEqual(await page.evaluate(() => excelQa.calls), []);
  report.cases.push('immediate-busy-and-cancel-during-gate');

  await convert.click();
  await page.evaluate(() => excelQa.resolveGate(true));
  await page.waitForFunction(() => Boolean(excelQa.resolveConversion));
  const options = await page.evaluate(() => excelQa.calls.find(call => call.command === 'convert_excel_to_pdf').args.options);
  assert.deepEqual(options, { sheetRange: 'all', orientation: 'source', paper: 'auto', scale: 'fit' });
  await page.evaluate(() => excelQa.resolveConversion({ outputDir: 'C:/output', successCount: 1, outputs: [{ pageCount: 3 }] }));
  await page.waitForSelector('[data-excel-success].visible');
  await page.locator('[data-excel-action="success-ok"]').click();
  assert.equal(await page.locator('[data-excel-success]').evaluate(node => node.inert), true);
  assert.equal(await convert.evaluate(node => node === document.activeElement), true);
  report.cases.push('fit-options-and-success-focus');
  await page.evaluate(() => { excelQa.controller.close(); excelQa.controller.open(); });
  await convert.click();
  await page.evaluate(() => excelQa.resolveGate(false));
  await page.waitForFunction(() => !document.querySelector('[data-excel-action="convert"]').disabled);
  report.cases.push('reopen-and-runtime-decline-recovery');
  await convert.click();
  await page.evaluate(() => { excelQa.controller.dispose(); excelQa.resolveGate(true); });
  assert.equal(await page.evaluate(() => excelQa.calls.filter(call => call.command === 'convert_excel_to_pdf').length), 1);
  report.cases.push('dispose-ignores-stale-runtime-check');

  const pdf = await PDFDocument.create();
  const pdfPage = pdf.addPage([300, 150]);
  const font = pdf.context.register(pdf.context.obj({
    Type: 'Font', Subtype: 'Type0', BaseFont: 'STSong-Light', Encoding: 'UniGB-UCS2-H',
    DescendantFonts: [pdf.context.obj({ Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'STSong-Light',
      CIDSystemInfo: { Registry: PDFHexString.fromText('Adobe'), Ordering: PDFHexString.fromText('GB1'), Supplement: 4 },
      FontDescriptor: { Type: 'FontDescriptor', FontName: 'STSong-Light', Flags: 4, FontBBox: [0, -200, 1000, 900], ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 880, StemV: 80 }
    })]
  }));
  pdfPage.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font } }));
  pdfPage.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream('BT /F1 24 Tf 20 80 Td <4E2D65876D4B8BD5> Tj ET')));
  const cjkBytes = Array.from(await pdf.save());
  const rendered = await page.evaluate(async bytes => {
    const pdfjs = await import('/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const worker = await import('/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs?url');
    const { pdfjsDocumentOptions, destroyPdfDocument } = await import('/src/shared/pdfjs-options.js');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument(pdfjsDocumentOptions({ data: new Uint8Array(bytes) }));
    const pdf = await task.promise;
    try {
      const first = await pdf.getPage(1);
      const canvas = document.createElement('canvas');
      canvas.width = 300; canvas.height = 150;
      const context = canvas.getContext('2d');
      await first.render({ canvasContext: context, viewport: first.getViewport({ scale: 1 }) }).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return { text: (await first.getTextContent()).items.map(item => item.str).join(''), ink: pixels.filter((value, i) => i % 4 === 0 && value < 100).length };
    } finally { await destroyPdfDocument(pdf); }
  }, cjkBytes);
  assert.equal(rendered.text, '\u4e2d\u6587\u6d4b\u8bd5');
  assert.ok(rendered.ink > 100);
  report.cases.push('offline-cjk-font-map-and-visible-render');
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
