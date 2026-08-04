import assert from 'node:assert/strict';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas, GifEncoder, loadImage } from '@napi-rs/canvas';
import { PDFDocument, rgb } from 'pdf-lib';

const DEBUG_ENDPOINT = process.env.TOOLKNIT_CDP_ENDPOINT || 'http://127.0.0.1:9223';
const QA_ROOT = path.join(tmpdir(), 'toolknit-image-stitch-native-qa');
const REPORT_PATH = path.resolve('tmp', 'image-stitch-native-report.json');

function solidImage(width, height, color, format = 'png') {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);
  if (color) {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }
  return format === 'jpg'
    ? canvas.toBuffer('image/jpeg', { quality: 92 })
    : canvas.toBuffer('image/png');
}

function jpegWithExifOrientation(width, height, color, orientation) {
  const jpeg = solidImage(width, height, color, 'jpg');
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0, 20);
  tiff.writeUInt32LE(0, 22);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]);
}

function animatedGif() {
  const encoder = new GifEncoder(2, 2, { repeat: 0, quality: 10 });
  encoder.addFrame(Uint8Array.from([
    255, 0, 0, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255
  ]), 2, 2, { delay: 80 });
  encoder.addFrame(Uint8Array.from([
    0, 0, 255, 255, 0, 0, 255, 255,
    0, 0, 255, 255, 0, 0, 255, 255
  ]), 2, 2, { delay: 80 });
  return encoder.finish();
}

async function pixelAt(imagePath, x, y) {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect() {
    const targets = await fetch(`${DEBUG_ENDPOINT}/json/list`).then((response) => {
      if (!response.ok) throw new Error(`WebView2 debug endpoint returned HTTP ${response.status}`);
      return response.json();
    });
    const target = targets.find((item) => item.type === 'page' && /localhost:1420/.test(item.url))
      || targets.find((item) => item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('ToolKnit WebView target was not found.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Cannot connect to the ToolKnit WebView.')), { once: true });
    });
    const client = new CdpClient(socket);
    await client.send('Runtime.enable');
    return client;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result?.value;
  }

  async invoke(command, args = {}) {
    const result = await this.evaluate(`(async () => {
      try {
        return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}) };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    })()`);
    if (!result?.ok) throw new Error(result?.error || `${command} failed`);
    return result.value;
  }

  close() {
    this.socket.close();
  }
}

async function expectInvokeFailure(client, command, args, pattern) {
  await assert.rejects(() => client.invoke(command, args), pattern);
}

async function waitFor(client, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function installProgressListener(client) {
  const setup = await client.evaluate(`(async () => {
    window.__qaImageStitchProgress = [];
    window.__qaImageStitchHandler = window.__TAURI_INTERNALS__.transformCallback((event) => {
      window.__qaImageStitchProgress.push(event.payload || event);
    });
    window.__qaImageStitchEventId = await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'image-stitch-progress',
      target: { kind: 'Any' },
      handler: window.__qaImageStitchHandler
    });
    return { handler: window.__qaImageStitchHandler, eventId: window.__qaImageStitchEventId };
  })()`);
  assert.ok(Number.isInteger(setup?.eventId), 'native progress listener must register');
}

async function clearProgress(client) {
  await client.evaluate('window.__qaImageStitchProgress = []; true');
}

async function progressFor(client, jobId) {
  return client.evaluate(`window.__qaImageStitchProgress.filter((event) => event.jobId === ${JSON.stringify(jobId)})`);
}

async function runRound(client, round) {
  const root = path.join(QA_ROOT, `round-${round}`);
  const inputs = path.join(root, '输入 图片');
  const outputs = path.join(root, '输出 结果');
  await mkdir(inputs, { recursive: true });
  await mkdir(outputs, { recursive: true });

  const red = path.join(inputs, '红 色.png');
  const blue = path.join(inputs, '蓝色.png');
  const green = path.join(inputs, 'green.png');
  const transparent = path.join(inputs, '透明.png');
  const oriented = path.join(inputs, '方向 6.jpg');
  const damaged = path.join(inputs, 'damaged.png');
  const animated = path.join(inputs, 'animated.gif');
  await Promise.all([
    writeFile(red, solidImage(10, 20, '#ff0000')),
    writeFile(blue, solidImage(20, 10, '#0000ff')),
    writeFile(green, solidImage(12, 6, '#00ff00')),
    writeFile(transparent, solidImage(10, 10, null)),
    writeFile(oriented, jpegWithExifOrientation(4, 2, '#663399', 6)),
    writeFile(damaged, Buffer.from('not an image')),
    writeFile(animated, animatedGif())
  ]);

  const inspected = await client.invoke('inspect_image_stitch_inputs', { inputPaths: [red, blue, green] });
  assert.deepEqual(inspected.map(item => [item.name, item.width, item.height]), [
    ['红 色.png', 10, 20], ['蓝色.png', 20, 10], ['green.png', 12, 6]
  ]);
  assert.ok(inspected.every(item => /^data:image\/png;base64,/.test(item.thumbnail_data_url)));
  const orientedPreview = await client.invoke('inspect_image_stitch_inputs', { inputPaths: [oriented] });
  assert.deepEqual([orientedPreview[0].width, orientedPreview[0].height], [2, 4], 'EXIF orientation 6 must swap dimensions');

  await clearProgress(client);
  const verticalJob = `native-round-${round}-vertical`;
  const customOutputName = `原生长图-${round}`;
  const vertical = await client.invoke('stitch_images', {
    inputPaths: [red, blue], outputDir: outputs, outputName: customOutputName, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92,
    backgroundRgba: '#FFFFFFFF', jobId: verticalJob
  });
  assert.deepEqual([vertical.width, vertical.height, vertical.count, vertical.format], [10, 25, 2, 'PNG']);
  assert.equal(path.basename(vertical.output_path), `${customOutputName}.png`);
  assert.deepEqual(await pixelAt(vertical.output_path, 5, 19), [255, 0, 0, 255]);
  assert.deepEqual(await pixelAt(vertical.output_path, 5, 20), [0, 0, 255, 255], '0px seam must contain no phantom gap');
  const verticalEvents = await progressFor(client, verticalJob);
  assert.deepEqual([...new Set(verticalEvents.map(event => event.phase))], ['prepare', 'inspect', 'compose', 'encode', 'complete']);
  assert.equal(verticalEvents.at(-1)?.percent, 100);
  assert.ok(verticalEvents.every((event, index) => index === 0 || event.percent >= verticalEvents[index - 1].percent), 'progress must be monotonic');

  const horizontal = await client.invoke('stitch_images', {
    inputPaths: [red, blue], outputDir: outputs, mode: 'horizontal', reference: 'largest',
    spacingPx: 3, scalePercent: 50, format: 'png', jpegQuality: 92,
    backgroundRgba: '#00FF00FF', jobId: `native-round-${round}-horizontal`
  });
  assert.deepEqual([horizontal.width, horizontal.height], [28, 10]);
  assert.deepEqual(await pixelAt(horizontal.output_path, 4, 5), [255, 0, 0, 255]);
  assert.deepEqual(await pixelAt(horizontal.output_path, 5, 5), [0, 255, 0, 255]);
  assert.deepEqual(await pixelAt(horizontal.output_path, 7, 5), [0, 255, 0, 255]);
  assert.deepEqual(await pixelAt(horizontal.output_path, 8, 5), [0, 0, 255, 255], 'gap count must be exactly count - 1');

  const referenceExpectations = { first: [12, 40], smallest: [10, 34], largest: [20, 64] };
  for (const [reference, expected] of Object.entries(referenceExpectations)) {
    const result = await client.invoke('stitch_images', {
      inputPaths: [green, red, blue], outputDir: outputs, mode: 'vertical', reference,
      spacingPx: 2, scalePercent: 100, format: 'png', jpegQuality: 92,
      backgroundRgba: '#FFFFFFFF', jobId: `native-round-${round}-${reference}`
    });
    assert.deepEqual([result.width, result.height], expected, `${reference} reference layout must be exact`);
  }

  const alpha = await client.invoke('stitch_images', {
    inputPaths: [transparent, blue], outputDir: outputs, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92,
    backgroundRgba: '#12345600', jobId: `native-round-${round}-alpha`
  });
  assert.equal((await pixelAt(alpha.output_path, 2, 2))[3], 0, 'PNG transparency must be preserved');

  const jpeg = await client.invoke('stitch_images', {
    inputPaths: [transparent, blue], outputDir: outputs, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'jpg', jpegQuality: 92,
    backgroundRgba: '#FF00FF00', jobId: `native-round-${round}-jpeg`
  });
  const jpegPixel = await pixelAt(jpeg.output_path, 2, 2);
  assert.ok(jpegPixel[0] > 220 && jpegPixel[2] > 220, 'JPG must flatten transparency onto the chosen RGB background');

  const unique = await client.invoke('stitch_images', {
    inputPaths: [red, blue], outputDir: outputs, outputName: customOutputName, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92,
    backgroundRgba: '#FFFFFFFF', jobId: `native-round-${round}-unique`
  });
  assert.notEqual(unique.output_path, vertical.output_path, 'existing output must never be overwritten');
  assert.equal(path.basename(unique.output_path), `${customOutputName}_1.png`);

  await expectInvokeFailure(client, 'stitch_images', {
    inputPaths: [red, blue], outputDir: outputs, outputName: '../escape', mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92, backgroundRgba: '#FFFFFFFF'
  }, /invalid-output-name/);
  await expectInvokeFailure(client, 'stitch_images', {
    inputPaths: [red, blue], outputDir: outputs, outputName: 'CON', mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92, backgroundRgba: '#FFFFFFFF'
  }, /invalid-output-name/);

  const pdfSession = await client.invoke('create_image_stitch_pdf_session');
  const pdfSessionId = pdfSession.session_id || pdfSession.sessionId;
  const pdfSessionDirectory = pdfSession.directory;
  const pdfPage1 = await client.invoke('write_image_stitch_pdf_page', {
    sessionId: pdfSessionId, pageNumber: 1, bytes: Array.from(solidImage(10, 20, '#ff0000'))
  });
  const pdfPage2 = await client.invoke('write_image_stitch_pdf_page', {
    sessionId: pdfSessionId, pageNumber: 2, bytes: Array.from(solidImage(20, 10, '#0000ff'))
  });
  assert.equal(path.basename(pdfPage1), 'page_0001.png');
  assert.equal(path.basename(pdfPage2), 'page_0002.png');
  const pdfPagePreviews = await client.invoke('inspect_image_stitch_inputs', { inputPaths: [pdfPage1, pdfPage2] });
  assert.deepEqual(pdfPagePreviews.map(item => item.name), ['page_0001.png', 'page_0002.png']);
  const pdfBridge = await client.invoke('stitch_images', {
    inputPaths: [pdfPage1, pdfPage2], outputDir: outputs, outputName: `pdf-pages-${round}`,
    mode: 'vertical', reference: 'first', spacingPx: 0, scalePercent: 100,
    format: 'png', jpegQuality: 92, backgroundRgba: '#FFFFFFFF', jobId: `native-round-${round}-pdf`
  });
  assert.deepEqual([pdfBridge.width, pdfBridge.height], [10, 25]);
  assert.deepEqual(await pixelAt(pdfBridge.output_path, 5, 20), [0, 0, 255, 255], 'PDF pages must enter the stitcher in page-number order');
  await expectInvokeFailure(client, 'write_image_stitch_pdf_page', {
    sessionId: pdfSessionId, pageNumber: 3, bytes: [1, 2, 3]
  }, /invalid-pdf-page/);
  await client.invoke('discard_image_stitch_pdf_session', { sessionId: pdfSessionId });
  await assert.rejects(() => readdir(pdfSessionDirectory), /ENOENT/);

  await expectInvokeFailure(client, 'stitch_images', {
    inputPaths: [red, red], outputDir: outputs, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92, backgroundRgba: '#FFFFFFFF'
  }, /Duplicate image file/);
  await expectInvokeFailure(client, 'stitch_images', {
    inputPaths: [red, damaged], outputDir: outputs, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92, backgroundRgba: '#FFFFFFFF'
  }, /Cannot read dimensions/);
  await expectInvokeFailure(client, 'stitch_images', {
    inputPaths: [red, animated], outputDir: outputs, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92, backgroundRgba: '#FFFFFFFF'
  }, /animated/);

  const tinyDirectory = path.join(inputs, '100 张边界');
  await mkdir(tinyDirectory, { recursive: true });
  const tinyBuffer = solidImage(1, 1, '#112233');
  const tinyPaths = Array.from({ length: 101 }, (_, index) => path.join(tinyDirectory, `${String(index + 1).padStart(3, '0')}.png`));
  await Promise.all(tinyPaths.map(file => writeFile(file, tinyBuffer)));
  const boundary = await client.invoke('stitch_images', {
    inputPaths: tinyPaths.slice(0, 100), outputDir: outputs, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92,
    backgroundRgba: '#FFFFFFFF', jobId: `native-round-${round}-boundary`
  });
  assert.deepEqual([boundary.width, boundary.height, boundary.count], [1, 100, 100]);
  await expectInvokeFailure(client, 'stitch_images', {
    inputPaths: tinyPaths, outputDir: outputs, mode: 'vertical', reference: 'first',
    spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92, backgroundRgba: '#FFFFFFFF'
  }, /at most 100/);

  const cancelInputs = path.join(inputs, '取消 测试');
  const cancelOutput = path.join(root, '取消 输出');
  await mkdir(cancelInputs, { recursive: true });
  await mkdir(cancelOutput, { recursive: true });
  const cancelBuffer = solidImage(1200, 700, '#345678', 'jpg');
  const cancelPaths = Array.from({ length: 32 }, (_, index) => path.join(cancelInputs, `large-${String(index + 1).padStart(2, '0')}.jpg`));
  await Promise.all(cancelPaths.map(file => writeFile(file, cancelBuffer)));
  const cancelJob = `native-round-${round}-cancel`;
  await clearProgress(client);
  const startState = await client.evaluate(`(() => {
    window.__qaImageStitchCancelDone = false;
    window.__qaImageStitchCancelResult = null;
    window.__TAURI_INTERNALS__.invoke('stitch_images', ${JSON.stringify({
      inputPaths: cancelPaths, outputDir: cancelOutput, mode: 'vertical', reference: 'first',
      spacingPx: 0, scalePercent: 100, format: 'png', jpegQuality: 92,
      backgroundRgba: '#FFFFFFFF', jobId: cancelJob
    })}).then(
      value => { window.__qaImageStitchCancelResult = { ok: true, value }; },
      error => { window.__qaImageStitchCancelResult = { ok: false, error: String(error) }; }
    ).finally(() => { window.__qaImageStitchCancelDone = true; });
    return 'started';
  })()`);
  assert.equal(startState, 'started');
  await waitFor(client, `window.__qaImageStitchProgress.some((event) => event.jobId === ${JSON.stringify(cancelJob)} && event.percent >= 2)`);
  await client.invoke('cancel_convert');
  await waitFor(client, 'window.__qaImageStitchCancelDone === true');
  const cancelResult = await client.evaluate('window.__qaImageStitchCancelResult');
  assert.equal(cancelResult?.ok, false, 'cancelled native operation must reject');
  assert.match(cancelResult?.error || '', /cancelled/);
  const cancelEntries = await readdir(cancelOutput);
  assert.ok(!cancelEntries.some(name => name.startsWith('.toolknit-stitch-')), 'cancelled operation must remove temporary files');
  assert.ok(!cancelEntries.some(name => /^stitched_image/.test(name)), 'cancelled operation must not publish an output');

  return { round, root, outputCount: (await readdir(outputs)).length };
}

async function runDesktopPdfWorkflow(client) {
  const sessionRoot = path.join(tmpdir(), 'toolknit-image-stitch-pdf');
  await client.evaluate(`(() => {
    const clear = document.getElementById('imageStitchClear');
    if (clear && !clear.disabled) clear.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelectorAll('#imageStitchQueue .image-stitch-row').length === 0");
  const cleanupDeadline = Date.now() + 10_000;
  while (Date.now() < cleanupDeadline) {
    const sessions = await readdir(sessionRoot).catch(() => []);
    if (sessions.length === 0) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.deepEqual(await readdir(sessionRoot).catch(() => []), [], 'pre-existing desktop PDF sessions must be cleaned before QA');

  const fixture = path.join(QA_ROOT, 'desktop-pdf-workflow.pdf');
  const document = await PDFDocument.create();
  const firstPage = document.addPage([100, 200]);
  firstPage.drawRectangle({ x: 0, y: 0, width: 100, height: 200, color: rgb(1, 0, 0) });
  const secondPage = document.addPage([200, 100]);
  secondPage.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: rgb(0, 0, 1) });
  await writeFile(fixture, await document.save());

  assert.equal(await client.evaluate("typeof window.importPdfToImageStitcher === 'function' && typeof window.openImageStitcher === 'function'"), true);
  const importState = await client.evaluate(`(async () => {
    const originalToast = window.showToast;
    const messages = [];
    window.showToast = message => messages.push(String(message));
    try {
      return { imported: await window.importPdfToImageStitcher(${JSON.stringify(fixture)}), messages };
    } finally {
      window.showToast = originalToast;
    }
  })()`);
  assert.equal(importState.imported, true, `desktop PDF workflow failed: ${JSON.stringify(importState.messages)}`);
  const importedState = await client.evaluate(`({
    rows: document.querySelectorAll('#imageStitchQueue .image-stitch-row').length,
    names: [...document.querySelectorAll('#imageStitchQueue .image-stitch-row-info strong')].map(item => item.textContent),
    estimate: document.getElementById('imageStitchEstimate')?.textContent,
    previewVisible: !document.getElementById('imageStitchPreview')?.hidden
  })`);
  assert.deepEqual(importedState.names, ['page_0001.png', 'page_0002.png']);
  assert.equal(importedState.rows, 2);
  assert.equal(importedState.estimate, '200 × 500 px');
  assert.equal(importedState.previewVisible, true);

  const configuredOutputRoot = await client.invoke('get_output_root');
  const desktopOutputRoot = path.join(QA_ROOT, 'desktop-output-root');
  await mkdir(desktopOutputRoot, { recursive: true });
  await client.invoke('set_output_root', { outputDir: desktopOutputRoot });

  const clickState = await client.evaluate(`(() => {
    const input = document.getElementById('imageStitchOutputName');
    input.value = 'desktop-pdf-result';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.__qaOriginalShowToast = window.showToast;
    window.__qaDesktopToasts = [];
    window.showToast = message => window.__qaDesktopToasts.push(String(message));
    const button = document.getElementById('imageStitchExport');
    const state = {
      disabled: button.disabled,
      classes: button.className,
      estimate: document.getElementById('imageStitchEstimate').textContent
    };
    button.click();
    return state;
  })()`);
  assert.equal(clickState.disabled, false, `desktop export button is unexpectedly disabled: ${JSON.stringify(clickState)}`);
  try {
    await waitFor(client, "document.getElementById('imageStitchSuccessOverlay').classList.contains('visible') || window.__qaDesktopToasts.length > 0", 30_000);
    const executionState = await client.evaluate(`({
      visible: document.getElementById('imageStitchSuccessOverlay').classList.contains('visible'),
      toasts: window.__qaDesktopToasts,
      outputPath: document.getElementById('imageStitchSuccessPath').textContent
    })`);
    assert.equal(executionState.visible, true, `desktop export did not complete: ${JSON.stringify({ executionState, clickState, configuredOutputRoot })}`);
    assert.equal(path.basename(executionState.outputPath), 'desktop-pdf-result.png');
    assert.equal(await client.invoke('exists_path', { path: executionState.outputPath }), true, 'desktop export must publish the output file');
    const exportedImage = await loadImage(executionState.outputPath);
    assert.deepEqual([exportedImage.width, exportedImage.height], [200, 500]);
    const completedState = await client.evaluate(`({
      visible: document.getElementById('imageStitchSuccessOverlay').classList.contains('visible'),
      rows: document.querySelectorAll('#imageStitchQueue .image-stitch-row').length,
      meta: document.getElementById('imageStitchSuccessMeta').textContent,
      size: document.getElementById('imageStitchSuccessSize').textContent
    })`);
    assert.deepEqual(completedState, { visible: true, rows: 0, meta: '2 张图片 / PNG', size: '200 × 500 px' });
  } finally {
    await client.evaluate(`(() => {
      if (window.__qaOriginalShowToast) window.showToast = window.__qaOriginalShowToast;
      delete window.__qaOriginalShowToast;
      document.getElementById('imageStitchSuccessOverlay')?.classList.remove('visible');
      return true;
    })()`);
    await client.invoke('set_output_root', { outputDir: configuredOutputRoot });
  }
  assert.deepEqual(await readdir(sessionRoot), [], 'desktop completion must clean PDF page sessions');
  console.log('Native desktop PDF-to-stitch workflow passed');
}

await rm(QA_ROOT, { recursive: true, force: true });
await mkdir(QA_ROOT, { recursive: true });
const client = await CdpClient.connect();
try {
  assert.equal(await client.evaluate("typeof window.__TAURI_INTERNALS__ === 'object'"), true, 'target must be the native Tauri WebView');
  await installProgressListener(client);
  const results = [];
  for (let round = 1; round <= 3; round++) {
    results.push(await runRound(client, round));
    console.log(`Native image stitch QA round ${round}/3 passed`);
  }
  await runDesktopPdfWorkflow(client);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({ endpoint: DEBUG_ENDPOINT, qaRoot: QA_ROOT, results }, null, 2)}\n`);
  console.log(`Native image stitch QA passed: ${QA_ROOT}`);
} finally {
  client.close();
}
