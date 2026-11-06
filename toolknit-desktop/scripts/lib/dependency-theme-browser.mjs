import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDependencyHelpers } from '../../src/app/dependency-helpers.js';

const managers = [
  ['transcriptionModel', 'manageOfflineModels', 'transcriptionSourceOptions'],
  ['mattingModel', 'manageMattingModelsBtn', 'mattingSourceOptions'],
  ['ffmpegRuntime', 'manageFfmpegRuntime', 'ffmpegRuntimeSourceOptions'],
  ['libreOfficeRuntime', 'manageLibreOfficeRuntime', 'libreOfficeRuntimeSourceOptions']
];

export async function checkDependencyTheme(browser, url, output) {
  await mkdir(output, { recursive: true });
  const report = { layouts: [], errors: [], fixtures: 'Model rows and dependency progress are visual fixtures; no native downloads or user files.' };
  const origin = new URL(url).origin;
  for (const language of ['zh', 'en']) {
    const locale = JSON.parse(await readFile(new URL(`../../src/locales/${language}.json`, import.meta.url), 'utf8'));
    const helpers = createDependencyHelpers({ translate: (key, values = {}) => key.split('.').reduce((value, part) => value?.[part], locale)
      ?.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match) });
    const officeDetail = helpers.dependencyInstallingDetail('LibreOffice', {
      extraction: { elapsed_seconds: 1199, extracted_files: 12000, extracted_bytes: 1500000000 }
    });
    const officeError = helpers.dependencyErrorMessage('libreoffice-runtime:extract-stalled:action=InstallFiles_elapsed=1499s_idle=300s_files=12000');
    const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await context.addInitScript(lang => {
      localStorage.setItem('toolknit.theme.v3', 'light');
      localStorage.setItem('toolknit-lang', lang);
    }, language);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.text().includes('Blocked aria-hidden')) report.errors.push(message.text()); });
    const settle = () => page.waitForFunction(() => {
      const veil = document.querySelector('[data-tk-page-transition-veil]');
      return !veil || getComputedStyle(veil).visibility === 'hidden';
    });
    const click = async selector => { await page.locator(selector).first().click(); await settle(); };
    const style = (selector, property) => page.locator(selector).first().evaluate((node, key) => getComputedStyle(node)[key], property);
    const capture = name => page.screenshot({ path: path.join(output, `${language}-${name}.png`), animations: 'disabled' });
    const closed = selector => page.waitForFunction(selector => {
      const node = document.querySelector(selector);
      return !node.classList.contains('visible') && node.inert && !node.contains(document.activeElement);
    }, selector);
    async function layout(root, panel, name) {
      await page.evaluate(() => document.fonts.ready);
      await page.locator(panel).evaluate(node => { node.scrollTop = 0; });
      const failures = await page.locator(panel).evaluate(panel => {
        const issues = [];
        const box = panel.getBoundingClientRect();
        if (box.left < 0 || box.right > innerWidth + 1 || box.top < 0 || box.bottom > innerHeight + 1) issues.push('panel outside viewport');
        if (panel.scrollWidth > panel.clientWidth + 2) issues.push('panel horizontal overflow');
        for (const node of panel.querySelectorAll('button, h2, h3, p, .transcription-model-name, .transcription-model-meta, #dependencyGateProgressText')) {
          const r = node.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.left < box.left || r.right > box.right || node.scrollWidth > node.clientWidth + 2) issues.push(node.id || node.className);
        }
        return issues;
      });
      assert.deepEqual(failures, [], `${language} ${name}: content fits`);
      assert.equal(await style(panel, 'backgroundColor'), 'rgb(255, 255, 255)');
      assert.equal(await style(panel, 'borderRadius'), '32px');
      assert.equal(await style(root, 'backdropFilter'), 'blur(12px)', 'built CSS retains the standard backdrop-filter property');
      assert.equal(await page.locator(root).evaluate(node => node.inert), false);
      await capture(name);
      await page.locator(panel).evaluate(node => { node.scrollTop = node.scrollHeight; });
      assert.ok(await page.locator(panel).evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1));
      const last = page.locator(`${panel} button`).last();
      await last.scrollIntoViewIfNeeded();
      assert.equal(await last.evaluate(node => {
        const r = node.getBoundingClientRect();
        const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return target === node || node.contains(target);
      }), true, 'last action is reachable and not covered by the settings navigation');
      await capture(`${name}-bottom`);
      report.layouts.push({ language, name, viewport: page.viewportSize() });
    }
    try {
      await page.goto(url);
      await page.waitForSelector('#homeToolGrid .tool-result-card');
      await click('#homeV2Settings');
      for (const [id, trigger, sources] of managers) {
        await page.setViewportSize({ width: 1400, height: 887 });
        await click(`#${trigger}`);
        await page.waitForFunction(id => document.getElementById(`${id}Overlay`).classList.contains('visible'), id);
        // Static DOM fixtures mirror renderTranscriptionModels/renderMattingModelManager.
        // They exercise the shared CSS without downloading models in a browser test.
        await page.locator(`#${id}Overlay .transcription-model-list`).evaluate((list, { lang, officeDetail }) => {
          const make = (tag, className, text) => {
            const node = document.createElement(tag); node.className = className;
            if (text) node.textContent = text;
            return node;
          };
          list.replaceChildren();
          for (let i = 0; i < 5; i++) {
            const row = make('div', 'transcription-model-row');
            const info = make('div', '');
            info.append(make('div', 'transcription-model-name', ['Whisper Small', 'MODNet', 'FFmpeg', 'LibreOffice', 'Whisper Medium'][i]),
              make('div', 'transcription-model-meta', i === 3 ? officeDetail : lang === 'zh' ? '488 MB - 本地运行时 / 官方下载源' : '488 MB - Local runtime / Official download source'));
            const actions = make('div', 'transcription-model-actions');
            if (i === 0 || i === 3) actions.append(make('span', 'transcription-model-current', i === 3 ? '45%' : lang === 'zh' ? '当前模型' : 'Current model'));
            const button = make('button', 'settings-btn', lang === 'zh' ? ['删除', '使用此模型', '下载', '正在校验', '下载'][i] : ['Delete', 'Use model', 'Download', 'Verifying', 'Download'][i]);
            button.type = 'button'; button.disabled = i === 3; actions.append(button);
            row.append(info, actions);
            if (i === 3) { const bar = make('div', 'transcription-model-progress'); const fill = make('span', ''); fill.style.width = '45%'; bar.append(fill); row.append(bar); }
            list.append(row);
          }
        }, { lang: language, officeDetail });
        assert.equal(await page.locator(`#${sources} [data-source]`).count(), 0);
        assert.match(await page.locator(`#${sources}`).textContent(), language === 'zh' ? /七彩云/ : /7Caiyun/);
        if (id === 'ffmpegRuntime') {
          const source = page.locator('#ffmpegRuntimeOverlay [data-home-link="ffmpegSource"]');
          assert.equal((await source.textContent()).trim(), locale.settings.ffmpegSource);
          assert.equal(await source.locator('svg.lucide-github').count(), 1, 'GitHub icon is rendered by the shared icon runtime');
          const popupPromise = page.waitForEvent('popup');
          await source.click();
          const popup = await popupPromise;
          await popup.waitForURL('https://github.com/ZihangDong/toolknit-ffmpeg-sources');
          await popup.close();
        }
        assert.equal(await style(`#${id}Overlay .settings-btn:disabled`, 'backgroundColor'), 'rgb(213, 214, 217)');
        const action=`#${id}Overlay .transcription-model-actions .settings-btn:not(:disabled)`;
        assert.equal(await style(action, 'backgroundColor'), 'rgb(17, 17, 17)', 'light manager actions are black without hover');
        assert.equal(await style(action, 'color'), 'rgb(255, 255, 255)');
        assert.equal(await style(action, 'borderRadius'), '999px');
        assert.equal(await style(`#${id}Overlay .transcription-model-progress > span`, 'backgroundColor'), 'rgb(17, 17, 17)');
        if (id === 'mattingModel') assert.equal(await style(`#${id}Overlay`, 'transitionDuration'), '0s', 'matting opens without the legacy dark transition');
        for (const [width, height] of [[1400, 887], [720, 480], [390, 740], [720, 320]]) {
          await page.setViewportSize({ width, height });
          await layout(`#${id}Overlay`, `#${id}Overlay .transcription-model-panel`, `${id}-${width}-${height}`);
        }
        await page.locator(`#${id}Close`).focus();
        assert.equal(await style(`#${id}Close`, 'outlineColor'), 'rgb(17, 17, 17)');
        await click(`#${id}Close`);
        await closed(`#${id}Overlay`);
        assert.equal(await style(`#${id}Overlay`, 'backdropFilter'), 'none', 'hidden managers do not keep backdrop filters active');
        await click(`#${trigger}`);
        await click(`#${id}Close`);
        await closed(`#${id}Overlay`);
      }
      await page.setViewportSize({ width: 1400, height: 887 });
      // Exercise the real no-key gate, not an artificial .visible toggle.
      await click('#settingsBack');
      await page.locator('.audio-list-item[data-tool="ai-doc"]').first().evaluate(node => node.click());
      await page.waitForSelector('#aiKeyRequiredOverlay.visible');
      for (const [width, height] of [[1400, 887], [720, 480], [390, 740], [720, 320]]) {
        await page.setViewportSize({ width, height });
        await layout('#aiKeyRequiredOverlay', '#aiKeyRequiredOverlay .ffmpeg-overlay-content', `missing-key-${width}-${height}`);
      }
      assert.equal(await style('#aiKeyRequiredGoSettings', 'color'), 'rgb(255, 255, 255)');
      await click('#aiKeyRequiredCancel');
      await closed('#aiKeyRequiredOverlay');
      await page.locator('.audio-list-item[data-tool="ai-doc"]').first().evaluate(node => node.click());
      await page.waitForSelector('#aiKeyRequiredOverlay.visible');
      await click('#aiKeyRequiredGoSettings');
      await closed('#aiKeyRequiredOverlay');
      await page.waitForSelector('#apiKeyOverlay.visible');
      await click('#apiKeyBack');
      await page.setViewportSize({ width: 1400, height: 887 });
      await page.waitForSelector('#settingsOverlay.visible');
      // The production gate is native-only. Use its real markup for long status,
      // error, indeterminate progress and disabled-button layout checks.
      await page.evaluate(({ lang, officeDetail, officeError }) => {
        const list = document.getElementById('dependencyGateList'); list.replaceChildren();
        for (const [name, state] of [['FFmpeg', 'ready'], ['Whisper Small', 'active'], ['LibreOffice', 'pending']]) {
          const row = document.createElement('div'); row.className = 'audio-convert-success-row dependency-gate-row';
          const key = document.createElement('span'); key.className = 'audio-convert-success-key'; key.textContent = name;
          const value = document.createElement('span'); value.className = 'audio-convert-success-value'; value.dataset.state = state;
          value.textContent = state === 'ready' ? (lang === 'zh' ? '已就绪' : 'Ready') : (lang === 'zh' ? '正在下载并校验本地运行时' : 'Downloading and verifying local runtime');
          row.append(key, value); list.append(row);
        }
        document.getElementById('dependencyGateProgress').hidden = false;
        document.getElementById('dependencyGateProgressFill').style.width = '45%';
        document.getElementById('dependencyGateProgressText').textContent = officeDetail;
        document.getElementById('dependencyGateError').hidden = false;
        document.getElementById('dependencyGateError').textContent = officeError;
        document.getElementById('dependencyGateInstall').disabled = true;
        document.getElementById('dependencyGateOverlay').classList.add('visible');
      }, { lang: language, officeDetail, officeError });
      await page.waitForFunction(() => getComputedStyle(document.getElementById('dependencyGateInstall')).backgroundColor === 'rgb(213, 214, 217)');
      for (const [width, height] of [[1400, 887], [720, 480], [390, 740], [720, 320]]) {
        await page.setViewportSize({ width, height });
        await layout('#dependencyGateOverlay', '#dependencyGateOverlay .dependency-gate-dialog', `dependency-${width}-${height}`);
      }
      await page.locator('#dependencyGateProgress').evaluate(node => { node.dataset.indeterminate = 'true'; });
      assert.equal(await style('#dependencyGateProgressFill', 'animationName'), 'dependency-gate-progress-wait');
      // No native task was started, so remove only the visual fixture.
      await page.locator('#dependencyGateOverlay').evaluate(node => node.classList.remove('visible'));
      await closed('#dependencyGateOverlay');
      await page.setViewportSize({ width: 1400, height: 887 });
      await click('[data-theme-choice="dark"]');
      for (const [id, trigger] of managers) {
        await click(`#${trigger}`);
        assert.notEqual(await style(`#${id}Overlay .transcription-model-panel`, 'backgroundColor'), 'rgb(255, 255, 255)');
        if (id === 'ffmpegRuntime') {
          const source = page.locator('#ffmpegRuntimeOverlay [data-home-link="ffmpegSource"]');
          for (const [width, height] of [[1400, 887], [390, 740]]) {
            await page.setViewportSize({ width, height });
            await source.scrollIntoViewIfNeeded();
            const fit = await source.evaluate(node => {
              const r = node.getBoundingClientRect();
              const panel = node.closest('.transcription-model-panel').getBoundingClientRect();
              const icon = node.querySelector('svg').getBoundingClientRect();
              return { fits: r.left >= panel.left && r.right <= panel.right && r.top >= panel.top && r.bottom <= panel.bottom,
                iconWidth: icon.width, iconHeight: icon.height, color: getComputedStyle(node).color };
            });
            assert.equal(fit.fits, true, 'dark source button is reachable and fits the dialog');
            assert.equal(fit.iconWidth, 16); assert.equal(fit.iconHeight, 16);
            assert.notEqual(fit.color, 'rgb(0, 0, 0)');
            await capture(`ffmpeg-source-dark-${width}`);
          }
          await page.setViewportSize({ width: 1400, height: 887 });
        }
        await capture(`${id}-dark`);
        await click(`#${id}Close`);
      }
      await click('[data-theme-choice="light"]');
    } catch (error) {
      report.error = String(error.stack || error);
      await capture('failure').catch(() => {});
      throw error;
    } finally {
      await context.close();
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
  assert.deepEqual(report.errors, [], 'dependency dialogs have no page errors or focus warnings');
  return `stage-three light dialogs: ${report.layouts.length} layouts, sources, close/reopen, missing-key navigation and dark isolation`;
}
