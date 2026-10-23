import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import JSZip from 'jszip';
import { auditVisibleColors } from './lib/theme-color-audit.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = path.resolve('tmp/theme-audit-v32/generated-ppt');
await mkdir(output, { recursive: true });
const auditOnly = process.argv.includes('--audit');
const apiUrl = 'https://theme-ppt.test/v1/chat/completions';
const payload = {
  ready: true, title: 'Theme audit presentation', subtitle: 'Generated local verification document',
  deck_type: 'training', audience: 'Test audience', purpose: 'Check readable generated output',
  fact_bank: { known_facts: ['Local synthetic content'], evidence: ['Generated test fixture'], assumptions: ['No private data'], missing_facts: ['Release date unconfirmed'], no_invention: ['No fabricated metrics'] },
  narrative: { communication_job: 'Explain the test.', arc: 'Context -> evidence -> action', central_takeaway: 'Generated results must remain readable.' },
  design: { style: 'Minimal', visual_system: 'Clear hierarchy', color_hint: 'Monochrome', font_hint: 'Arial' },
  slides: Array.from({ length: 3 }, (_, i) => ({ page: i + 1, type: i === 0 ? 'title' : i === 2 ? 'closing' : 'content',
    title: `Readable slide ${i + 1}`, claim: `Complete explanation ${i + 1}`, body: ['First point', 'Second point'],
    role: i === 0 ? 'cover' : i === 2 ? 'closing' : 'content', visual_suggestion: 'A labeled diagram',
    layout_intent: { kind: 'text-focus', density: 'low', text_blocks: 2, media_slots: 0, chart: 'none', visual_focus: 'Test statement' },
    speaker_note: 'Explain the sample without inventing facts.', transition: 'Continue to the next point.' })),
  quality_check: { missing_info: ['Confirm the release date'], risks: ['Check before sharing'], next_steps: ['Review slides'], self_check: { score: 88, passed: true, issues: ['Date unconfirmed'], strengths: ['Clear structure'] } }
};
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { source: 'Real app UI and local export; AI HTTP response is a synthetic fixture, not a live provider test.', cases: [], errors: [] };
try {
  for (const theme of ['light', 'dark']) {
    for (const language of ['zh', 'en']) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce' });
      await context.addInitScript(({ theme, language, apiUrl }) => {
        localStorage.setItem('toolknit.theme.v3', theme);
        localStorage.setItem('toolknit-lang', language);
        localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
        localStorage.setItem('ai_platform', 'custom');
        localStorage.setItem('ai_custom_url', apiUrl);
        localStorage.setItem('ai_custom_model', 'theme-fixture');
        localStorage.setItem('ai_api_key', 'local-theme-test-not-a-real-key');
      }, { theme, language, apiUrl });
      let releaseResponse;
      await context.route('**/*', async route => {
        if (route.request().url() === apiUrl) {
          await new Promise(resolve => { releaseResponse = resolve; });
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(payload) } }] }) });
        } else if (new URL(route.request().url()).origin === new URL(url).origin) await route.continue();
        else await route.fulfill({ body: '{}' });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') console.log(`[${theme}/${language}] ${message.text()}`); });
      page.on('console', message => { if (message.text().includes('Blocked aria-hidden')) report.errors.push(message.text()); });
      await page.goto(url);
      await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
      for (const [id, prefix] of [['ppt-outline', 'pptOutline'], ['ppt-draft', 'pptDraft']]) {
        const label = `${theme}-${language}-${id}`;
        const result = { label, states: [] };
        report.cases.push(result);
        await page.locator(`.audio-list-item[data-tool="${id}"]`).evaluate(n => n.click());
        await page.locator(`#${prefix}Overlay.visible`).waitFor();
        await page.waitForFunction(prefix => getComputedStyle(document.getElementById(`${prefix}Overlay`)).opacity === '1', prefix);
        await page.waitForFunction(() => {
          const veil = document.querySelector('[data-tk-page-transition-veil]');
          return !veil || getComputedStyle(veil).visibility === 'hidden';
        });
        await page.locator(`#${prefix}Prompt`).fill('Create a three-slide test of clearly readable output. Use only supplied facts.');
        await page.locator(`#${prefix}SlideCount`).fill('3');
        const requested = page.waitForRequest(apiUrl);
        await page.locator(`#${prefix}GenerateBtn`).click();
        await requested;
        await page.locator(`#${prefix}ProcessMask.visible`).waitFor();
        await page.waitForFunction(prefix => getComputedStyle(document.getElementById(`${prefix}ProcessMask`)).opacity === '1', prefix);
        const progress = await page.locator(`#${prefix}ProcessBarFill`).evaluate(node => ({ color: getComputedStyle(node).backgroundColor, width: node.getBoundingClientRect().width }));
        assert.notEqual(progress.color, 'rgba(0, 0, 0, 0)', 'portal progress fill must receive theme tokens');
        assert.ok(progress.width > 1, 'actual progress remains visible');
        await page.screenshot({ path: path.join(output, `${label}-processing.png`) });
        result.states.push({ state: 'processing', ...await page.evaluate(auditVisibleColors, `#${prefix}ProcessMask`) });
        const downloaded = page.waitForEvent('download', { timeout: 30000 }).catch(error => ({ error }));
        releaseResponse();
        const download = await downloaded;
        if (download.error) {
          await page.screenshot({ path: path.join(output, `${label}-failed.png`) });
          result.error = await page.locator('.app-toast-message').allTextContents();
          throw download.error;
        }
        const zip = await JSZip.loadAsync(await readFile(await download.path()));
        assert.ok(Object.keys(zip.files).some(name => name.endsWith(id === 'ppt-draft' ? '.pptx' : 'outline.md')));
        await page.locator(`#${prefix}SuccessOverlay.visible`).waitFor();
        await page.waitForFunction(prefix => getComputedStyle(document.getElementById(`${prefix}SuccessOverlay`)).opacity === '1', prefix);
        await page.screenshot({ path: path.join(output, `${label}-success.png`) });
        result.states.push({ state: 'success', ...await page.evaluate(auditVisibleColors, `#${prefix}SuccessOverlay`) });
        await page.locator(`#${prefix}SuccessOk`).click();
        for (const viewport of [{ width: 1400, height: 900 }, { width: 1000, height: 650 }, { width: 720, height: 640 }]) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(250);
          for (const position of [0, .5, 1]) {
            await page.locator(`#${prefix}Overlay`).evaluate((root, fraction) => {
              for (const node of root.querySelectorAll('*')) {
                if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 20) node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction;
              }
            }, position);
            await page.waitForTimeout(100);
            const audit = await page.evaluate(auditVisibleColors, `#${prefix}Result`);
            result.states.push({ state: 'result', viewport, position, ...audit });
            await page.screenshot({ path: path.join(output, `${label}-${viewport.width}-${position}.png`) });
          }
        }
        await page.setViewportSize({ width: 1400, height: 900 });
        if (id === 'ppt-draft') {
          const card = page.locator('[data-ppt-draft-slide-index="0"]');
          await page.keyboard.press('Tab');
          await card.focus();
          const focus = await card.evaluate(node => ({ ink: getComputedStyle(node).color, outline: getComputedStyle(node).outlineColor, offset: getComputedStyle(node).outlineOffset }));
          assert.equal(focus.outline, focus.ink, 'card keyboard focus follows theme ink');
          assert.equal(focus.offset, '-3px');
          await page.locator('[data-ppt-draft-slide-index="0"]').click();
          await page.locator('#pptDraftEditorOverlay.visible').waitFor();
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#pptDraftEditorOverlay')).opacity === '1');
          for (const position of [0, 1]) {
            await page.locator('.ppt-draft-editor-inspector').evaluate((node, fraction) => { node.scrollTop = node.scrollHeight * fraction; }, position);
            await page.waitForTimeout(100);
            result.states.push({ state: 'editor', position, ...await page.evaluate(auditVisibleColors, '#pptDraftEditorOverlay') });
            await page.screenshot({ path: path.join(output, `${label}-editor-${position}.png`) });
          }
          await page.locator('#pptDraftEditorSlideTitle').fill('Edited readable title');
          for (const [trigger, overlay, back] of [
            ['#pptDraftEditorV2Settings', '#settingsOverlay', '#settingsBack'],
            ['#pptDraftEditorOverlay [data-tool-help]', '#helpOverlay', '#helpBackBtn'],
            ['#pptDraftEditorOverlay [data-tool-feedback]', '#feedbackOverlay', '#feedbackBack'],
            ['#pptDraftEditorOverlay [data-open-support]', '#donationOverlay', '#donationOverlay .donation-close']
          ]) {
            await page.locator(trigger).click();
            await page.locator(`${overlay}.visible`).waitFor();
            await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).opacity === '1', overlay);
            if (overlay !== '#settingsOverlay') {
              assert.equal(await page.locator('#pptDraftEditorOverlay').evaluate(node => node.inert), true, `${overlay}: nested modal suspends the editor`);
            }
            assert.equal(await page.locator(back).evaluate(node => {
              const box = node.getBoundingClientRect();
              return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
            }), true, `${overlay}: top page owns pointer input`);
            await page.locator(back).click();
            await page.locator(`${overlay}.visible`).waitFor({ state: 'hidden' });
            await page.waitForFunction(() => !document.querySelector('#pptDraftEditorOverlay').inert);
            assert.equal(await page.locator('#pptDraftOverlay').evaluate(node => node.inert), true, 'return leaves the underlying draft locked');
            assert.equal(await page.locator('#pptDraftEditorSlideTitle').inputValue(), 'Edited readable title');
            result.states.push({ state: 'editor-navigation-return', target: overlay, ...await page.evaluate(auditVisibleColors, '#pptDraftEditorOverlay') });
          }
          await page.locator('#pptDraftEditorBack').click();
          assert.equal(await page.locator('#pptDraftOverlay').getAttribute('aria-hidden'), 'false');
          await page.locator('[data-ppt-draft-slide-index="0"]').click();
          assert.equal(await page.locator('#pptDraftEditorSlideTitle').inputValue(), 'Edited readable title');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#pptDraftEditorOverlay.visible').count(), 0);
          assert.equal(await page.locator('#pptDraftOverlay.visible').count(), 1);
          await page.locator('[data-ppt-draft-slide-index="0"]').click();
          const editedDownload = page.waitForEvent('download');
          await page.locator('#pptDraftEditorExportBtn').click();
          const editedZip = await JSZip.loadAsync(await readFile(await (await editedDownload).path()));
          const pptxFile = Object.values(editedZip.files).find(file => file.name.endsWith('.pptx'));
          assert.ok(pptxFile, 'edited draft exports a PPTX');
          const pptx = await JSZip.loadAsync(await pptxFile.async('uint8array'));
          const outlineFile = Object.values(editedZip.files).find(file => file.name.endsWith('outline.json'));
          assert.ok((await outlineFile.async('string')).includes('Edited readable title'), 'edited title persists to the output outline');
          assert.ok(pptx.file('ppt/slides/slide1.xml'), 'edited PPTX contains slide XML');
          await page.locator('#pptDraftSuccessOk').click();
        }
        await page.locator(`#${prefix}Back`).click();
        await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        const findings = result.states.flatMap(state => state.findings).filter(f => !f.ambiguous && f.opacity === 1 && f.contrast < 3);
        console.log(`${label}: ${findings.length} severe color candidates, ZIP export passed`);
        if (!auditOnly) assert.deepEqual(findings, [], label);
      }
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
