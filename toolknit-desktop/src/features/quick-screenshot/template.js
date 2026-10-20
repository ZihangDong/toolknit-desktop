import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
const text=key=>`data-i18n="home.quickScreenshot.${key}"`;
export default `<div id="quickScreenshotOverlay" class="pdf-merge-overlay pdf-merge-v2 tool-page-v2-light quick-screenshot" data-tool-page-chrome role="dialog" aria-modal="true" aria-hidden="true" inert>
${toolTopbarMarkup({tag:'QUICK SCREENSHOT · V3.2',title:'QUICK SCREENSHOT',closeAttr:'data-screenshot-close'})}
<div class="screenshot-workbench"><aside class="screenshot-settings">
<h1 ${text('title')}></h1><p ${text('subtitle')}></p>
<button id="screenshotStart" class="screenshot-primary" type="button"><i data-lucide="scan"></i><span ${text('start')}></span></button>
<section><h2 ${text('shortcut')}></h2><label><input id="screenshotShortcut" maxlength="64" placeholder="Alt+Q" autocomplete="off" data-i18n-aria-label="home.quickScreenshot.shortcut"></label>
<div class="screenshot-row"><button id="screenshotShortcutSave" type="button" ${text('apply')}></button><button id="screenshotShortcutReset" type="button" ${text('resetShortcut')}></button><button id="screenshotShortcutDisable" type="button" ${text('disableShortcut')}></button></div><p id="screenshotShortcutStatus" role="status"></p></section>
<section><div class="screenshot-setting-row"><div><h2 ${text('floatingHistory')}></h2><p ${text('historyHint')}></p></div><button id="screenshotHistoryToggle" class="screenshot-switch" type="button" role="switch" aria-checked="false" data-i18n-aria-label="home.quickScreenshot.floatingHistory"><span></span></button></div></section>
<section><h2 ${text('aiModel')}></h2><p id="screenshotProvider"></p><button type="button" data-tool-settings ${text('configureAi')}></button></section>
<p id="screenshotPageError" class="screenshot-error" role="alert" hidden></p></aside>
<main class="screenshot-page-preview"><i data-lucide="scan-line"></i><h2 ${text('ready')}></h2><p ${text('privacy')}></p><div class="screenshot-capabilities"><span ${text('localOcr')}></span><span ${text('annotations')}></span><span ${text('pinViewer')}></span></div></main></div></div>`;
