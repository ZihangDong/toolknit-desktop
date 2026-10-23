import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { pdfjsAssets } from './lib/pdfjs-assets.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/video-frame-theme-ui');
await mkdir(output, { recursive: true });

const server = await createServer({
  configFile: false,
  plugins: [pdfjsAssets()],
  cacheDir: 'tmp/video-frame-theme-ui/vite-cache',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  optimizeDeps: { entries: ['index.html'] }
});
let browser;
let page;

try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {})
  });
  page = await browser.newPage({ viewport: { width: 1400, height: 887 } });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('toolknit.theme.v3', 'light'));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });

  assert.equal(await page.locator('#videoFramePick').count(), 0);
  assert.equal(await page.locator('#videoGifPick').count(), 0);

  const verifyEmptyState = async ({ tool, overlay, empty, description, button }) => {
    await page.locator(`[data-tool="${tool}"]`).first().evaluate(node => node.click());
    await page.waitForSelector(`${overlay}.visible`);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const state = await page.locator(empty).evaluate(node => {
        const description = node.querySelector('.tk-empty-hero-description');
        const button = node.querySelector('.tk-empty-hero-action');
        const style = element => getComputedStyle(element);
        return {
          description: description.textContent.trim(),
          descriptionColor: style(description).color,
          buttonBackground: style(button).backgroundColor,
          buttonColor: style(button).color,
          buttonTransition: style(button).transitionProperty
        };
      });
      assert.equal(state.description, description);
      assert.notEqual(state.descriptionColor, 'rgba(0, 0, 0, 0)');
      assert.equal(state.buttonBackground, theme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)');
      assert.equal(state.buttonColor, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(9, 9, 9)');
      assert.match(state.buttonTransition, /transform/);

      const action = page.locator(button);
      const before = await action.evaluate(node => ({
        background: getComputedStyle(node).backgroundColor,
        color: getComputedStyle(node).color
      }));
      await action.hover();
      await page.waitForTimeout(190);
      const hovered = await action.evaluate(node => ({
        background: getComputedStyle(node).backgroundColor,
        color: getComputedStyle(node).color,
        transform: getComputedStyle(node).transform
      }));
      assert.deepEqual({ background: hovered.background, color: hovered.color }, before);
      assert.notEqual(hovered.transform, 'none');
      await page.mouse.move(4, 4);
      await page.waitForTimeout(190);
      assert.equal(await action.evaluate(node => getComputedStyle(node).transform), 'none');
      await page.locator(empty).screenshot({ path: path.join(output, `${tool}-${theme}-empty.png`) });
    }
    await page.locator(`${overlay} [data-tool-page-back], ${overlay} .pdf-merge-v2-back`).first().click();
  };

  await verifyEmptyState({
    tool: 'video-frame',
    overlay: '#videoFrameOverlay',
    empty: '#videoFrameEmpty',
    description: '支持 MP4、MOV、MKV、WebM、AVI，可逐帧定位并导出高清图片。',
    button: '#videoFrameEmpty .tk-empty-hero-action'
  });
  await verifyEmptyState({
    tool: 'video-gif',
    overlay: '#videoGifOverlay',
    empty: '#videoGifEmpty',
    description: '支持 MP4、MOV、MKV、WebM、AVI，可截取片段并生成 GIF。',
    button: '#videoGifEmpty .tk-empty-hero-action'
  });

  await page.locator('[data-tool="video-frame"]').first().evaluate(node => node.click());
  await page.waitForSelector('#videoFrameOverlay.visible');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    document.querySelector('#videoFrameEmpty').hidden = true;
    document.querySelector('#videoFrameEditor').hidden = false;
    document.querySelector('#videoFrameOverlay').classList.add('is-editing');
    document.querySelector('#videoFrameName').textContent = 'preview-sample.mp4';
  });
  const surfaces = await page.evaluate(() => {
    const previewCard = document.querySelector('.video-frame-v2 .video-media-v2-preview-card');
    const fileBar = document.querySelector('.video-frame-v2 .video-media-v2-file');
    const controls = document.querySelector('.video-frame-v2 .video-frame-control-card');
    return {
      preview: getComputedStyle(previewCard).backgroundColor,
      file: getComputedStyle(fileBar).backgroundColor,
      controls: getComputedStyle(controls).backgroundColor,
      controlsHeight: controls.getBoundingClientRect().height,
      exportTop: document.querySelector('#videoFrameExport').getBoundingClientRect().top,
      formatBottom: document.querySelector('#videoFrameFormat').getBoundingClientRect().bottom
    };
  });
  assert.equal(surfaces.preview, 'rgb(5, 5, 6)');
  assert.equal(surfaces.file, 'rgb(5, 5, 6)');
  assert.equal(surfaces.controls, 'rgb(255, 255, 255)');
  assert.ok(surfaces.exportTop - surfaces.formatBottom < surfaces.controlsHeight * 0.35);
  await page.locator('#videoFrameEditor').screenshot({ path: path.join(output, 'video-frame-light-editor.png') });

  await page.locator('#videoFrameOverlay .pdf-merge-v2-back').first().click();
  await page.locator('[data-tool="video-gif"]').first().evaluate(node => node.click());
  await page.waitForSelector('#videoGifOverlay.visible');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#videoGifOverlay')).opacity === '1');
  await page.evaluate(() => {
    document.querySelector('#videoGifEmpty').hidden = true;
    document.querySelector('#videoGifEditor').hidden = false;
    document.querySelector('#videoGifOverlay').classList.add('is-editing');
    document.querySelector('#videoGifName').textContent = 'preview-sample.mp4';
    document.querySelector('#videoGifTimeline').max = '8780';
    document.querySelector('#videoGifTimelineWrap').style.setProperty('--gif-end', '100%');
    document.querySelector('#videoGifEndLabel').textContent = '00:08.780';
    document.querySelector('#videoGifDurationLabel').textContent = '8.780 秒 / 最多 30 秒';
    document.querySelector('#videoGifEstimate').textContent = '预计体积：2.4 MB - 4.5 MB · 105 帧 · 640×288 · 均衡';
  });

  for (const theme of ['light', 'dark']) {
    await page.mouse.move(1, 1);
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.constructor.name !== 'CSSTransition' || animation.playState !== 'running'));
    const state = await page.locator('#videoGifEditor').evaluate(node => {
      const select = selector => node.querySelector(selector);
      const style = selector => getComputedStyle(select(selector));
      const rect = selector => select(selector).getBoundingClientRect();
      const card = select('.video-gif-v2-control-card');
      const optionRows = ['#videoGifFrameRate', '#videoGifResolution', '#videoGifQuality'];
      return {
        cardBackground: getComputedStyle(card).backgroundColor,
        startText: style('#videoGifSelectStart strong').color,
        endText: style('#videoGifSelectEnd strong').color,
        nudgeText: style('#videoGifAdjustHint').color,
        nudgeButton: style('#videoGifPrev').color,
        estimateText: style('#videoGifEstimate').color,
        track: style('.video-gif-timeline-track').backgroundColor,
        selection: style('.video-gif-timeline-selected').backgroundColor,
        trackWidth: rect('.video-gif-timeline-track').width,
        trackHeight: rect('.video-gif-timeline-track').height,
        selectionWidth: rect('.video-gif-timeline-selected').width,
        timelineBackground: style('#videoGifTimeline').backgroundColor,
        timelineAppearance: style('#videoGifTimeline').appearance,
        inactiveBackground: style('#videoGifFrameRate [data-fps="6"]').backgroundColor,
        activeBackground: style('#videoGifFrameRate .active').backgroundColor,
        activeText: style('#videoGifFrameRate .active').color,
        unobscured: card.contains(document.elementFromPoint(
          rect('#videoGifSelectStart').left + 12,
          rect('#videoGifSelectStart').top + 12
        )),
        noHorizontalOverflow: card.scrollWidth <= card.clientWidth + 2 && optionRows.every(selector => {
          const row = select(selector);
          return row.scrollWidth <= row.clientWidth + 2;
        }),
        ordered: rect('.video-media-v2-control-head').bottom <= rect('.video-gif-timeline-wrap').top
          && rect('.video-gif-timeline-wrap').bottom <= rect('.video-gif-selection').top
          && rect('.video-gif-selection').bottom <= rect('.video-gif-controls').top
          && rect('.video-gif-controls').bottom <= rect('.video-gif-v2-output-options').top
          && rect('.video-gif-v2-output-options').bottom <= rect('.video-gif-estimate').top
          && rect('.video-gif-estimate').bottom <= rect('#videoGifExport').top
      };
    });
    if (theme === 'light') assert.equal(state.cardBackground, 'rgb(255, 255, 255)');
    else assert.match(state.cardBackground, /^rgba\(255, 255, 255, 0\.02[67]\)$/);
    assert.equal(state.startText, theme === 'light' ? 'rgb(41, 42, 45)' : 'rgba(255, 255, 255, 0.86)');
    assert.equal(state.endText, state.startText);
    assert.equal(state.nudgeButton, state.startText);
    assert.notEqual(state.nudgeText, state.cardBackground);
    assert.notEqual(state.estimateText, state.cardBackground);
    assert.equal(state.track, theme === 'light' ? 'rgb(215, 217, 221)' : 'rgba(255, 255, 255, 0.24)');
    assert.equal(state.selection, theme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)');
    if (theme === 'light') assert.equal(state.inactiveBackground, 'rgb(245, 246, 247)');
    else assert.match(state.inactiveBackground, /^rgba\(255, 255, 255, 0\.04[35]\)$/);
    assert.equal(state.activeBackground, theme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)');
    assert.equal(state.activeText, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(23, 23, 23)');
    assert.ok(state.unobscured);
    assert.ok(state.trackWidth > 150 && state.selectionWidth > 150 && state.trackHeight >= 5, JSON.stringify(state));
    assert.equal(state.timelineBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(state.timelineAppearance, 'none');
    assert.ok(state.noHorizontalOverflow);
    assert.ok(state.ordered);
    await page.locator('#videoGifEditor').screenshot({ path: path.join(output, `video-gif-${theme}-editor.png`) });
  }
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const dimensions = await page.locator('.video-gif-v2-control-card').evaluate(card => ({
      card: [card.scrollWidth, card.clientWidth],
      rows: [...card.querySelectorAll('.audio-convert-format-options')].map(row => [row.scrollWidth, row.clientWidth]),
      buttonsFit: [...card.querySelectorAll('.audio-convert-format-option')].every(button => button.scrollWidth <= button.clientWidth + 2)
    }));
    assert.ok(dimensions.card[0] <= dimensions.card[1] + 2 && dimensions.rows.every(([scroll, client]) => scroll <= client + 2) && dimensions.buttonsFit, `${width}: ${JSON.stringify(dimensions)}`);
    await page.locator('#videoGifExport').scrollIntoViewIfNeeded();
    const exportBounds = await page.locator('#videoGifExport').boundingBox();
    assert.ok(exportBounds && exportBounds.y >= 0 && exportBounds.y + exportBounds.height <= 800, `${width}: ${JSON.stringify(exportBounds)}`);
  }
  assert.deepEqual(errors, []);
  console.log('Video frame/GIF themes, GIF editor controls, timeline and responsive layout passed');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
