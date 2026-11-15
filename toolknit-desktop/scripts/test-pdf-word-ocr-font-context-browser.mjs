import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = path.resolve('tmp/pdf-word-ocr-font-context-browser'); await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, cacheDir: path.join(out, 'vite'), logLevel: 'error', optimizeDeps: { entries: ['index.html'] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**', '**/dist/**', '**/cli/**', '**/src-tauri/target/**'] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true }), errors = [];
try {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  const report = await page.evaluate(async () => {
    const { buildOcrTtf } = await import('/src/features/pdf-to-word/core/ocr-font-ttf.js');
    const { createSourceFontScope } = await import('/src/features/pdf-to-word/adapters/source-font-runtime.js');
    const { generatedOcrPaintBounds, ocrPaintBounds } = await import('/src/features/pdf-to-word/adapters/ocr-paint-bounds.js');
    const { inferDocument, leafBlocks } = await import('/src/features/pdf-to-word/core/layout.js');
    const { drawResultText } = await import('/src/features/pdf-to-word/adapters/text-rendering.js');
    let checks = 0; const check = (condition, message) => { if (!condition) throw Error(message); checks++; };
    const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    const glyphs = [{ text: '一', advance: 900, contours: [[[0, 100], [800, 100], [800, 180], [0, 180]]] },
      { text: '不', advance: 1000, contours: [[[-50, -120], [700, -120], [700, 900], [-50, 900]]] }];
    const font = buildOcrTtf(glyphs, 'TKInk' + 'a'.repeat(24));
    const asset = { ...font, kind: 'font', format: 'ttf', id: 'font:' + font.name, fingerprint: await sha(font.bytes),
      ocrProvenance: { version: 1, page: 1, width: 1000, height: 1000, pixelFingerprint: '2'.repeat(64),
        glyphs: glyphs.map((g, i) => ({ text: g.text, sourceId: 'p1:ocr' + i, box: [10, 10, 50, 50], confidence: .999, points: 4 })) } };
    const scope = createSourceFontScope(); await scope.ensure([asset]);
    const make = () => new OffscreenCanvas(180, 120), canvas = make(), native = canvas.getContext('2d'), context = scope.context(native);
    context.font = `16px "${asset.name}"`; context.fontKerning = 'none';
    check(context.measureText('一不').width === 1900 / 64, 'generated advance is read from validated program');
    check(context.measureText('一').actualBoundingBoxDescent === -100 / 64, 'thin bars have no invented descender');
    check(context.measureText('不').actualBoundingBoxLeft === 50 / 64, 'negative bearing is retained');
    const width = native.measureText('一 不').width;
    context.letterSpacing = '2px'; context.wordSpacing = '3px';
    check(Math.abs(native.measureText('一 不').width - width - 9) < .001, 'real browser spacing counts each character and each space');
    check(context.measureText('一 不').width === 2156 / 64 + 9, 'exact program uses the same browser spacing contract');
    const reference = make(), other = reference.getContext('2d');
    for (const ctx of [context, other]) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 180, 120); ctx.fillStyle = '#111';
      ctx.translate(10.25, 5.5); ctx.scale(1.5, 1.25); ctx.beginPath(); ctx.rect(0, 0, 100, 85); ctx.clip();
    }
    // Independently draw the known rectangular source contours. This checks
    // transformed multi-character placement and maxWidth, not native font ink.
    const unit = 16 / 1024, textWidth = 2156 * unit + 9;
    context.fillText('一 不', 8.5, 40.25, 27);
    other.save(); other.translate(8.5, 40.25); other.scale(27 / textWidth, 1);
    other.fillRect(0, -180 * unit, 800 * unit, 80 * unit);
    other.fillRect((900 + 256 - 50) * unit + 7, -900 * unit, 750 * unit, 1020 * unit); other.restore();
    const painted = native.getImageData(0, 0, 180, 120).data, expected = other.getImageData(0, 0, 180, 120).data;
    check(painted.every((n, i) => n === expected[i]), 'real browser path painting matches independent source pixels under transform/clip/spacing/maxWidth');
    const originalTransform = native.getTransform(); context.fillText('一', 0, 0);
    check(['a', 'b', 'c', 'd', 'e', 'f'].every(key => native.getTransform()[key] === originalTransform[key]), 'painting retains native transform');
    for (const [name, value] of [['font', '16px Arial'], ['textAlign', 'center'], ['textBaseline', 'top'], ['direction', 'rtl']]) {
      context.font = `16px "${asset.name}"`; context.textAlign = 'left'; context.textBaseline = 'alphabetic'; context.direction = 'ltr'; context[name] = value;
      check(context.measureText('不').width === native.measureText('不').width, 'unsupported state keeps native metrics: ' + name);
    }
    context.font = `16px "${asset.name}"`; context.textAlign = 'left'; context.textBaseline = 'alphabetic'; context.direction = 'ltr';
    check(context.measureText('新').width === native.measureText('新').width, 'new absent glyph keeps native fallback');
    context.letterSpacing = context.wordSpacing = '0px';
    const resized = make(), resizedNative = resized.getContext('2d'), resizedContext = scope.context(resizedNative);
    resized.width = 210; resized.height = 140;
    resizedContext.font = `16px "${asset.name}"`; resizedContext.fontKerning = 'none';
    const resetWidth = resizedNative.measureText('一 不').width;
    resizedNative.letterSpacing = resizedNative.wordSpacing = '0px';
    check(resizedNative.measureText('一 不').width === resetWidth, 'resized empty spacing has native zero-spacing semantics');
    resized.width = 210; resizedContext.font = `16px "${asset.name}"`; resizedContext.fontKerning = 'none';
    check(resizedContext.measureText('一 不').width === 2156 / 64, 'exact metrics survive OffscreenCanvas resize and native default-spacing reset');
    resizedContext.fillStyle = '#fff'; resizedContext.fillRect(0, 0, 210, 140); resizedContext.fillStyle = '#000';
    resizedContext.fillText('一', 20, 30);
    const resetInk = resizedNative.getImageData(25, 27, 1, 2).data;
    check(resetInk[0] < 100 && resetInk[4] > 100 && resetInk[4] < 200,
      'actual program painting survives the resized canvas zero-spacing state');
    // Exact final-paint reservations must cover all emitted foreground. The
    // ordinary-font case deliberately has ink well outside its expected box.
    for (const ordinary of [false, true]) {
      const item = { type: 'text', id: 'p1:ocr0', sourceIds: ['p1:ocr0'], text: ordinary ? 'WWWWW' : '不',
        rect: { x: 40, y: 45, width: ordinary ? 2 : 750 / 64, height: ordinary ? 3 : 1020 / 64 },
        font: ordinary ? 'Arial' : asset.name, size: 16, baseline: 60, baselineX: 40, preciseInk: true, ocr: true,
        ...(ordinary ? {} : { fontAssetId: asset.id, glyphScale: 100 }) };
      const document = inferDocument([{ number: 1, width: 160, height: 100, items: [item], sources: [{ id: item.id, text: item.text, rect: item.rect, disposition: 'editable' }], rules: [], risks: [], characters: item.text.length }], { preserveGeometry: true });
      const line = leafBlocks([...document.pages[0].header, ...document.pages[0].blocks, ...document.pages[0].footer]).flatMap(b => b.lines || [])[0];
      const metric = scope.context(make().getContext('2d')), sample = { x: 80, y: 90, w: ordinary ? 4 : 25, h: ordinary ? 6 : 34 }, sx = 2, sy = 2;
      const bounds = ocrPaintBounds(line, metric, sample, sx, sy);
      check(bounds && bounds.pad >= 3 && (!ordinary || bounds.pad > 100), 'complete measured bounds include distant ordinary-font ink');
      const large = new OffscreenCanvas(600, 400), largeContext = scope.context(large.getContext('2d'));
      largeContext.fillStyle = '#fff'; largeContext.fillRect(0, 0, 600, 400); largeContext.setTransform(sx, 0, 0, sy, 100 - sample.x, 100 - sample.y);
      drawResultText(document.pages[0], largeContext);
      const pixels = largeContext.getImageData(0, 0, 600, 400).data;
      check(pixels.every((n, i) => i % 4 === 3 || n >= 180 || i / 4 % 600 >= 100 - bounds.pad && i / 4 % 600 < 100 + sample.w + bounds.pad
        && Math.floor(i / 4 / 600) >= 100 - bounds.pad && Math.floor(i / 4 / 600) < 100 + sample.h + bounds.pad), 'reserved canvas contains all actual foreground');
      if (!ordinary) {
        const planned = generatedOcrPaintBounds({ bounds: [-50, -120, 700, 900], size: 16, scale: 100,
          baseline: 60, tight: item.rect, sample, sx, sy });
        check(JSON.stringify(planned) === JSON.stringify(bounds), 'generated reservation equals actual serialized measured footprint');
      }
    }
    scope.dispose(); scope.dispose();
    check(![...document.fonts].some(face => face.family === asset.name), 'document disposal releases FontFace');
    check(context.measureText('不').width === native.measureText('不').width, 'a retained proxy cannot retain disposed programs');
    return { checks };
  });
  assert.deepEqual(errors, []); await writeFile(path.join(out, 'report.json'), JSON.stringify({ ...report, errors }, null, 2));
  console.log(`OCR program browser: ${report.checks} exact metrics/paint, spacing, fallback, bounds and disposal checks passed.`);
} finally { await browser.close(); await server.close(); }
