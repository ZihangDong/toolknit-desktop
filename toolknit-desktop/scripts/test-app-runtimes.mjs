import assert from 'node:assert/strict';
import { createAiSettingsRuntime } from '../src/app/ai-settings-runtime.js';
import { createExternalLinksRuntime } from '../src/app/external-links-runtime.js';
import { createHomeExplorerRuntime } from '../src/app/home-explorer-runtime.js';
import { createFontSettingsRuntime } from '../src/app/font-settings-runtime.js';
import { createToastManager } from '../src/app/toast-manager.js';
import { createModalRuntime, createModalSession, setModalInteractivity } from '../src/app/modal-runtime.js';
import { createAutostartRuntime } from '../src/app/autostart-runtime.js';
import { bindGlobalToolPageChrome } from '../src/shared/tool-page-shell.js';
import { createHelpCenterRuntime } from '../src/app/help-center-runtime.js';

class FakeElement extends EventTarget {
  constructor(id = '') {
    super();
    this.id = id;
    this.dataset = {};
    this.children = [];
    this.style = {};
    this.className = '';
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach(name => this.classList.values.add(name)),
      remove: (...names) => names.forEach(name => this.classList.values.delete(name)),
      toggle: (name, force) => {
        const next = force === undefined ? !this.classList.values.has(name) : Boolean(force);
        if (next) this.classList.values.add(name); else this.classList.values.delete(name);
        return next;
      },
      contains: name => this.classList.values.has(name)
    };
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  remove() { this.removed = true; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.focused = true; }
  closest(selector) {
    if (selector.includes('[data-remove-favorite]') && this.dataset.removeFavorite) return this;
    if (selector.includes('[data-home-tool]') && this.dataset.homeTool) return this;
    if (selector.includes('.favorite-item') && this.className.includes('favorite-item')) return this;
    if (selector.includes('.tool-result-card') && this.className.includes('tool-result-card')) return this;
    if (selector.includes('.audio-list-item') && this.className.includes('audio-list-item')) return this;
    return null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  scrollTo() {}
}

class FakeRoot extends FakeElement {
  constructor(elements = []) {
    super('root');
    this.elements = new Map(elements.filter(Boolean).map(element => [element.id, element]));
    this.baseURI = 'http://localhost/';
    this.defaultView = { requestAnimationFrame: callback => callback(), setTimeout, clearTimeout };
  }
  createElement(tagName) {
    const element = new FakeElement();
    element.tagName = String(tagName || '').toUpperCase();
    return element;
  }
  getElementById(id) { return this.elements.get(id) || null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const makeByIdRoot = ids => new FakeRoot(ids.map(id => new FakeElement(id)));

// Optional DOM nodes must not make a runtime fail during initialization.
const emptyRoot = new FakeRoot();
const emptyAi = createAiSettingsRuntime({ root: emptyRoot, storage: null, aiKeyStore: null });
emptyAi.dispose();
const emptyLinks = createExternalLinksRuntime({ root: emptyRoot, storage: null, windowRef: { open() {} } });
emptyLinks.dispose();
const emptyHome = createHomeExplorerRuntime({ root: emptyRoot, storage: null });
emptyHome.dispose();
const emptyFonts = createFontSettingsRuntime({ root: emptyRoot, windowRef: {}, normalizeDesktopBytes: value => value });
emptyFonts.dispose();

const blocked = [];
const opened = [];
const links = createExternalLinksRuntime({
  root: emptyRoot,
  windowRef: { open: (...args) => opened.push(args) },
  onError: error => blocked.push(error.message)
});
assert.equal(await links.openExternalUrl('file:///secret.txt'), false);
assert.equal(await links.openExternalUrl('javascript:alert(1)'), false);
assert.equal(await links.openExternalUrl('https://toolknit.com/docs'), true);
assert.equal(opened[0][0], 'https://toolknit.com/docs');
assert.equal(blocked.length, 2);
links.dispose();

const aiElements = [
  'settingsApiKey', 'apiKeyOverlay', 'apiKeyBack', 'apiKeyInput', 'apiKeyToggle',
  'apiKeySave', 'apiKeyClear', 'apiKeyStatus', 'apiKeyDropdown', 'apiKeyDropdownTrigger',
  'apiKeyDropdownMenu', 'apiKeyDropdownValue', 'apiKeyCustomWrap', 'apiKeyCustomUrl',
  'apiKeyCustomModel', 'apiKeyPrivateHttpSwitch', 'aiKeyRequiredOverlay',
  'aiKeyRequiredCancel', 'aiKeyRequiredGoSettings'
].map(id => new FakeElement(id));
const aiRoot = new FakeRoot(aiElements);
const aiStore = { hasKey: () => false, get: async () => '', set: async () => {}, remove: async () => {} };
const ai = createAiSettingsRuntime({ root: aiRoot, storage: null, aiKeyStore: aiStore });
assert.equal(await ai.openToolWithAiCheck(), false);
assert.equal(aiRoot.getElementById('aiKeyRequiredOverlay').classList.contains('visible'), true);
aiRoot.getElementById('aiKeyRequiredCancel').dispatchEvent(new Event('click'));
assert.equal(aiRoot.getElementById('aiKeyRequiredOverlay').classList.contains('visible'), false);
ai.dispose();

const home = createHomeExplorerRuntime({ root: emptyRoot, storage: null });
assert.doesNotThrow(() => home.renderFavorites());
assert.doesNotThrow(() => home.renderHomeTools({ resetPagination: true }));
home.dispose();

// Home batching changes only the card projection and survives a new runtime.
{
  const batchRoot = makeByIdRoot(['homeToolSearch', 'homeToolGrid', 'homeToolLoadMore', 'homeToolLoadMoreButton', 'homeLazyLoadToggle', 'homeLazyLoadStatus']);
  const discoveries = ['quick-screenshot', 'pdf-to-scan', 'duplicate-file-cleanup', 'pdf-to-word', 'clipboard-history', 'image-to-pdf'];
  const tools = Array.from({ length: 27 }, (_, index) => {
    const tool = new FakeElement();
    tool.dataset.tool = discoveries[index - 21] || `fixture-${index}`;
    tool.closest = () => ({ dataset: { category: tool.dataset.tool.includes('pdf') ? 'pdf' : 'creative' } });
    return tool;
  });
  const chips = ['all', 'new', 'pdf'].map(category => {
    const chip = new FakeElement(); chip.dataset.homeCategory = category; return chip;
  });
  batchRoot.querySelectorAll = selector => selector.includes('.audio-list-item') ? tools
    : selector === '[data-home-category]' ? chips : [];
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const count = () => (batchRoot.getElementById('homeToolGrid').innerHTML.match(/data-home-tool=/g) || []).length;
  const toggle = batchRoot.getElementById('homeLazyLoadToggle');
  let runtime = createHomeExplorerRuntime({ root: batchRoot, storage });
  assert.equal(count(), 12, 'batching is enabled by default');
  batchRoot.getElementById('homeToolLoadMoreButton').dispatchEvent(new Event('click'));
  assert.equal(count(), 24);
  chips[1].dispatchEvent(new Event('click'));
  const ids = () => [...batchRoot.getElementById('homeToolGrid').innerHTML.matchAll(/data-home-tool="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids(), discoveries, 'new features are filtered before pagination, including older enhanced tools');
  assert.equal(batchRoot.getElementById('homeToolLoadMore').hidden, true);
  assert.equal(chips[1].getAttribute('aria-pressed'), 'true');
  const search = batchRoot.getElementById('homeToolSearch');
  search.value = 'pdf'; search.dispatchEvent(new Event('input'));
  assert.deepEqual(ids(), ['pdf-to-scan', 'pdf-to-word', 'image-to-pdf'], 'search intersects the new-feature filter');
  search.value = 'fixture'; search.dispatchEvent(new Event('input'));
  assert.equal(count(), 0, 'search does not leak tools from other categories');
  search.value = ''; search.dispatchEvent(new Event('input'));
  toggle.dispatchEvent(new Event('click'));
  assert.deepEqual(ids(), discoveries, 'disabling batching preserves the new-feature filter');
  toggle.dispatchEvent(new Event('click'));
  chips[2].dispatchEvent(new Event('click'));
  assert.deepEqual(ids(), ['pdf-to-scan', 'pdf-to-word', 'image-to-pdf'], 'featured tools retain their original categories');
  chips[0].dispatchEvent(new Event('click'));
  assert.equal(count(), 12, 'returning to all resets pagination');
  assert.equal(chips[1].getAttribute('aria-pressed'), 'false');
  toggle.dispatchEvent(new Event('click'));
  assert.equal(count(), 27);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(batchRoot.getElementById('homeToolLoadMore').hidden, true);
  assert.equal(values.get('toolknit_home_lazy_load'), 'false');
  runtime.renderHomeTools({ resetPagination: true });
  assert.equal(count(), 27, 'filter/language refresh does not restore batching');
  runtime.dispose();
  runtime = createHomeExplorerRuntime({ root: batchRoot, storage });
  assert.equal(count(), 27, 'preference survives runtime recreation');
  toggle.dispatchEvent(new Event('click'));
  assert.equal(count(), 12);
  runtime.dispose();
  toggle.dispatchEvent(new Event('click'));
  assert.equal(count(), 12, 'disposed listeners cannot change the preference');
  values.set('toolknit_home_lazy_load', 'invalid');
  runtime = createHomeExplorerRuntime({ root: batchRoot, storage });
  assert.equal(count(), 12, 'malformed preferences use the default');
  runtime.dispose();
  runtime = createHomeExplorerRuntime({ root: batchRoot, storage: { getItem() { throw new Error('unavailable'); } } });
  assert.equal(count(), 12, 'unavailable storage uses the default');
  runtime.dispose();
}

const favoritesContent = new FakeElement('favoritesContent');
const favoritesRoot = new FakeRoot([favoritesContent]);
const favoriteStorage = {
  getItem: () => JSON.stringify([{ tool: 'pdf-merge', name: 'PDF 文件合并', desc: '', iconHtml: '', category: 'pdf' }]),
  setItem: () => {}
};
const favoriteTranslations = {
  'home.toolNames.pdfCategoryTag': 'PDF工具'
};
const favorites = createHomeExplorerRuntime({
  root: favoritesRoot,
  storage: favoriteStorage,
  translate: key => favoriteTranslations[key] || key
});
assert.match(favoritesContent.innerHTML, /PDF工具/);
assert.doesNotMatch(favoritesContent.innerHTML, /PDF \/ LOCAL/);
favorites.dispose();

const toastRoot = makeByIdRoot(['toastContainer']);
const toastManager = createToastManager({
  root: toastRoot,
  getLanguage: () => 'zh',
  createIconElement: name => {
    const icon = new FakeElement();
    icon.dataset.icon = name;
    return icon;
  },
  setTimeoutFn: (callback, duration) => ({ callback, duration }),
  clearTimeoutFn: () => {}
});
const errorToast = toastManager.show('工具加载失败');
assert.equal(errorToast.el.children.length, 3);
assert.equal(errorToast.el.children[0].className, 'app-toast-icon');
assert.equal(errorToast.el.children[0].children[0].dataset.icon, 'error');
assert.equal(errorToast.el.children[2].children[0].dataset.icon, 'close');
assert.equal(errorToast.el.classList.contains('app-toast--error'), true);
assert.equal(errorToast.el.getAttribute('role'), 'alert');
assert.equal(errorToast.el.getAttribute('aria-live'), 'assertive');
const invalidToast = toastManager.show('这个文件不像有效的 PPTX，请换一个文件测试。');
assert.equal(invalidToast.el.classList.contains('app-toast--error'), true);
assert.equal(invalidToast.el.getAttribute('role'), 'alert');
const rawPptxErrorToast = toastManager.show('PPTX must be a valid ZIP-based PowerPoint file.');
assert.equal(rawPptxErrorToast.el.classList.contains('app-toast--error'), true);
assert.equal(rawPptxErrorToast.el.getAttribute('role'), 'alert');
const successToast = toastManager.show('文件保存完成');
assert.equal(successToast.el.classList.contains('app-toast--success'), true);
assert.equal(successToast.el.children[0].children[0].dataset.icon, 'success');
const infoToast = toastManager.show('正在准备文件', { kind: 'info', dismissible: false });
assert.equal(infoToast.el.classList.contains('app-toast--info'), true);
assert.equal(infoToast.el.children[2].style.display, 'none');
toastManager.dispose();

const fallbackToastRoot = makeByIdRoot(['toastContainer']);
const fallbackToastManager = createToastManager({
  root: fallbackToastRoot,
  setTimeoutFn: (callback, duration) => ({ callback, duration }),
  clearTimeoutFn: () => {}
});
const fallbackToast = fallbackToastManager.show('Failed to load tool');
assert.equal(fallbackToast.el.children[0].textContent, '!');
assert.equal(fallbackToast.el.children[2].textContent, '×');
fallbackToastManager.dispose();

// Hiding any modal must clear a focused descendant before aria-hidden/inert.
const modalButton = {
  blurCalled: false,
  blur() { this.blurCalled = true; modalDocument.activeElement = null; }
};
const modalOverlay = {
  nodeType: 1,
  id: 'modalOverlay',
  classList: { contains: () => false },
  contains: node => node === modalButton,
  toggleAttribute(name, value) { this[`${name}Value`] = value; },
  setAttribute(name, value) { this[`${name}Value`] = value; }
};
const modalDocument = {
  nodeType: 9,
  activeElement: modalButton,
  querySelectorAll: () => [modalOverlay],
  addEventListener() {},
  removeEventListener() {}
};
const modalRuntime = createModalRuntime({ documentRef: modalDocument });
modalRuntime.initA11y();
assert.equal(modalButton.blurCalled, true, 'hidden modal sync must remove focus before aria-hidden');
assert.equal(modalOverlay['aria-hiddenValue'], 'true');
assert.equal(modalOverlay.inertValue, true);
modalOverlay.classList.contains = () => true;
setModalInteractivity(modalOverlay, false);
modalRuntime.syncA11y(modalOverlay);
assert.equal(modalOverlay.inertValue, true, 'class observer must not unlock a modal background');
assert.equal(modalOverlay['aria-hiddenValue'], 'true');
setModalInteractivity(modalOverlay, true);
modalRuntime.syncA11y(modalOverlay);
assert.equal(modalOverlay.inertValue, false, 'closing sibling modal restores background interaction');
modalOverlay.classList.contains = () => false;
modalRuntime.syncA11y(modalOverlay);
assert.equal(modalOverlay.inertValue, true, 'a real visibility change still hides the region');
modalRuntime.dispose();

// Every lazy tool shares the document-level chrome delegate, including
// templates that still expose feature-specific data attributes.
const chromeOverlay = {
  classList: { contains: name => name === 'visible' },
  contains: () => false,
  ownerDocument: { activeElement: null }
};
const chromeTarget = ({ dataset = {}, matches = () => false } = {}) => ({
  dataset,
  matches,
  closest(selector) {
    if (selector.includes('[id$="Overlay"]')) return chromeOverlay;
    return this.matches(selector) ? this : null;
  }
});
const chromeRoot = {
  listeners: [],
  addEventListener(type, listener) {
    if (type === 'click') this.listeners.push(listener);
  },
  removeEventListener(type, listener) {
    if (type === 'click') this.listeners = this.listeners.filter(item => item !== listener);
  }
};
const chromeActions = [];
const unbindChrome = bindGlobalToolPageChrome({
  root: chromeRoot,
  onWebsite: () => chromeActions.push('website'),
  onSupport: () => chromeActions.push('support'),
  onSettings: () => chromeActions.push('settings'),
  onWindowAction: action => chromeActions.push(`window:${action}`)
});
const dispatchChromeClick = target => {
  let prevented = false;
  let stopped = false;
  const event = {
    target,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  };
  for (const listener of chromeRoot.listeners || []) listener(event);
  return { prevented, stopped };
};
const excelSettings = chromeTarget({
  dataset: { excelAction: 'settings' },
  matches: selector => selector.includes('[data-excel-action="settings"]')
});
const excelSettingsEvent = dispatchChromeClick(excelSettings);
assert.equal(excelSettingsEvent.prevented, true);
assert.equal(excelSettingsEvent.stopped, true);
assert.deepEqual(chromeActions, ['settings']);
const legacyWindowClose = chromeTarget({
  dataset: { windowAction: 'close' },
  matches: selector => selector.includes('[data-window-action]')
    || selector.includes('[data-window-action="close"]')
});
const closeEvent = dispatchChromeClick(legacyWindowClose);
assert.equal(closeEvent.prevented, true);
assert.equal(closeEvent.stopped, true);
assert.deepEqual(chromeActions, ['settings', 'window:close']);
const teleWebsite = chromeTarget({
  dataset: { teleAction: 'website' },
  matches: selector => selector.includes('[data-tele-action="website"]')
});
dispatchChromeClick(teleWebsite);
assert.deepEqual(chromeActions, ['settings', 'window:close', 'website']);
const backButton = chromeTarget({
  dataset: { toolClose: '' },
  matches: selector => selector.includes('[data-tool-close]')
});
dispatchChromeClick(backButton);
assert.deepEqual(chromeActions, ['settings', 'window:close', 'website'], 'back must remain feature-owned');
let subpageVisible = true;
const chromeSubpage = {
  classList: { contains: name => name === 'visible' && subpageVisible },
  contains: () => false,
  ownerDocument: { activeElement: null }
};
const subpageTarget = options => {
  const target = chromeTarget(options);
  const closest = target.closest.bind(target);
  target.closest = selector => selector.includes('[data-tool-page-chrome]') ? chromeSubpage
    : selector === '[id$="Overlay"]' ? null : closest(selector);
  return target;
};
for (const action of ['minimize', 'maximize', 'close']) {
  const before = chromeActions.length;
  dispatchChromeClick(subpageTarget({
    dataset: { toolWindow: action },
    matches: selector => selector.includes('[data-tool-window]') || selector.includes(`[data-tool-window="${action}"]`)
  }));
  assert.deepEqual(chromeActions.slice(before), [`window:${action}`], 'a visible subpage forwards each window action once');
}
const subpageSettings = subpageTarget({ matches: selector => selector.includes('[data-tool-settings]') });
dispatchChromeClick(subpageSettings);
assert.equal(chromeActions.at(-1), 'settings');
subpageVisible = false;
const beforeHiddenSubpage = chromeActions.length;
dispatchChromeClick(subpageSettings);
assert.equal(chromeActions.length, beforeHiddenSubpage, 'hidden subpage controls do not navigate');
subpageVisible = true;
unbindChrome();

const unbindTransitionChrome = bindGlobalToolPageChrome({
  root: chromeRoot,
  onToolBack: ({ overlay }) => overlay === chromeOverlay
});
assert.deepEqual(dispatchChromeClick(backButton), { prevented: true, stopped: true },
  'a transition-owned return must not also reach the feature listener');
assert.deepEqual(dispatchChromeClick(subpageTarget({ matches: selector => selector.includes('[data-tool-close]') })),
  { prevented: false, stopped: false }, 'subpage Back reaches its local handler, not the registered tool close');
unbindTransitionChrome();

const feedbackRoot = new FakeRoot([new FakeElement('feedbackOverlay'), new FakeElement('lightraysBg')]);
let feedbackTheme = 'light';
let themeListener;
let backgroundsCreated = 0;
let backgroundsDestroyed = 0;
const feedbackRuntime = createHelpCenterRuntime({
  root: feedbackRoot,
  getTheme: () => feedbackTheme,
  onThemeChange: listener => { themeListener = listener; return () => { themeListener = null; }; },
  initLightRays: () => { backgroundsCreated++; return { destroy: () => { backgroundsDestroyed++; } }; }
});
await feedbackRuntime.openFeedbackOverlay();
assert.equal(backgroundsCreated, 0, 'light feedback never starts the hidden WebGL effect');
feedbackTheme = 'dark';
themeListener();
themeListener();
assert.equal(backgroundsCreated, 1, 'dark feedback starts one effect');
feedbackTheme = 'light';
themeListener();
assert.equal(backgroundsDestroyed, 1, 'switching to light releases the effect');
await feedbackRuntime.closeFeedbackOverlay();
feedbackTheme = 'dark';
themeListener();
assert.equal(backgroundsCreated, 1, 'a closed page does not restart its effect');
await feedbackRuntime.openFeedbackOverlay();
await feedbackRuntime.closeFeedbackOverlay();
assert.equal(backgroundsDestroyed, 2);
feedbackRuntime.dispose();
feedbackRuntime.dispose();
assert.equal(themeListener, null, 'disposal removes the theme subscription');

const legalRoot = new FakeRoot(['legalOverlay', 'legalContentTitle', 'legalTopTag', 'legalContentBody']
  .map(id => new FakeElement(id)));
const legalSettings = new FakeElement('settingsOverlay');
legalSettings.classList.add('visible');
legalSettings.style.zIndex = '50000';
const legalRuntime = createHelpCenterRuntime({
  root: legalRoot,
  settingsOverlay: legalSettings,
  getLegalContent: () => ({
    declaration: { title: '程序声明', html: '<p>Declaration</p>' },
    'usage-policy': { title: '使用规范', html: '<p>Policy</p>' }
  })
});
await legalRuntime.openLegalOverlay();
assert.equal(legalSettings.classList.contains('visible'), false, 'legal pages replace settings rather than inherit its raised stacking layer');
assert.equal(legalSettings.style.zIndex, '');
assert.equal(legalRoot.getElementById('legalTopTag').textContent, 'ToolKnit Program Declaration');
legalRuntime.showLegalSection('usage-policy');
assert.equal(legalRoot.getElementById('legalTopTag').textContent, 'ToolKnit Usage Policy');
assert.equal(legalRoot.getElementById('legalContentTitle').textContent, '使用规范');
await legalRuntime.closeLegalOverlay();
legalRuntime.dispose();

// A homepage has no .visible class; modal close must restore its prior input state.
{
const modalDocument = new FakeRoot();
const modalBackground = new FakeElement('homepage');
const modalRoot = new FakeElement('customToolsOverlay');
modalRoot.ownerDocument = modalDocument;
modalBackground.inert = false;
const modalSession = createModalSession({ root: modalRoot, background: modalBackground });
modalSession.open();
assert.equal(modalBackground.inert, true);
modalSession.close();
assert.equal(modalBackground.inert, false);
assert.equal(modalRoot.inert, true);
modalBackground.inert = true;
modalSession.open();
modalSession.close();
assert.equal(modalBackground.inert, true, 'an already suspended background must stay suspended');
modalSession.dispose();

// Late key reads cannot reopen a page the user already left.
let completeKeyRead;
let settingsRestored = 0;
const delayedAiRoot = makeByIdRoot(['apiKeyOverlay', 'apiKeyInput', 'apiKeyBack']);
const delayedAi = createAiSettingsRuntime({ root: delayedAiRoot, storage: null,
  aiKeyStore: { get: () => new Promise(resolve => { completeKeyRead = resolve; }) },
  onOpenSettings: () => { settingsRestored++; }
});
const delayedOpening = delayedAi.openApiKeySettings();
await new Promise(resolve => setImmediate(resolve));
delayedAi.closeApiKeySettings();
completeKeyRead('');
await delayedOpening;
assert.equal(delayedAiRoot.getElementById('apiKeyOverlay').classList.contains('visible'), false);
assert.equal(settingsRestored, 1, 'a cancelled key read must only restore Settings when the API key page closes');
delayedAi.dispose();

// The protected key read stays behind the shared page veil, so Settings never
// becomes visible again between the click and the API key page activation.
let completeVisibleKeyRead;
let transitionCalls = 0;
let settingsOpened = 0;
let settingsClosed = 0;
const transitionRoot = makeByIdRoot(['apiKeyOverlay', 'apiKeyBack', 'apiKeyInput', 'settingsOverlay']);
transitionRoot.getElementById('settingsOverlay').classList.add('visible');
const transitionAi = createAiSettingsRuntime({ root: transitionRoot, storage: null,
  aiKeyStore: { get: () => new Promise(resolve => { completeVisibleKeyRead = resolve; }) },
  settingsOverlay: transitionRoot.getElementById('settingsOverlay'),
  onOpenSettings: () => { settingsOpened++; },
  onCloseSettings: () => { settingsClosed++; },
  pageTransition: { run: async action => { transitionCalls++; return action(); } }
});
const transitionOpening = transitionAi.openApiKeySettings();
await new Promise(resolve => setImmediate(resolve));
assert.equal(transitionCalls, 1);
assert.equal(settingsOpened, 0, 'the current Settings page must not be reopened during key loading');
assert.equal(transitionRoot.getElementById('apiKeyOverlay').classList.contains('visible'), false);
completeVisibleKeyRead('');
await transitionOpening;
assert.equal(settingsClosed, 1);
assert.equal(transitionRoot.getElementById('apiKeyOverlay').classList.contains('visible'), true);
transitionAi.dispose();

// Startup state is native-owned: duplicate clicks, tray changes, errors and late teardown.
const startupRoot = makeByIdRoot(['autostartToggle', 'autostartStatus']);
startupRoot.defaultView = new EventTarget();
const startupButton = startupRoot.getElementById('autostartToggle');
let nativeEnabled = false;
let writes = 0;
let completeWrite;
let unlistened = 0;
const startupListeners = new Map();
const startupMessages = [];
const startup = createAutostartRuntime({ root: startupRoot, isTauri: true,
  tauriCorePromise: Promise.resolve({ invoke: async (name, options) => {
    if (name === 'get_autostart') return { supported: true, enabled: nativeEnabled };
    writes++;
    await new Promise(resolve => { completeWrite = resolve; });
    nativeEnabled = options.enabled;
    startupListeners.get('toolknit-autostart-changed')?.({ payload: { supported: true, enabled: nativeEnabled } });
    return { supported: true, enabled: nativeEnabled };
  } }),
  tauriEventPromise: Promise.resolve({ listen: async (name, callback) => {
    startupListeners.set(name, callback);
    return () => { startupListeners.delete(name); unlistened++; };
  } }),
  notify: value => startupMessages.push(value)
});
const flush = () => new Promise(resolve => setImmediate(resolve));
await flush();
assert.equal(startupButton.disabled, false);
startupButton.dispatchEvent(new Event('click'));
startupButton.dispatchEvent(new Event('click'));
await flush();
assert.equal(writes, 1);
assert.equal(startupButton.disabled, true);
completeWrite();
await flush();
assert.equal(startupButton.getAttribute('aria-pressed'), 'true');
assert.equal(startupMessages.at(-1), 'settings.autostartEnabled', 'native event before command response preserves success feedback');
nativeEnabled = false;
startupListeners.get('toolknit-autostart-changed')({ payload: { supported: true, enabled: false } });
assert.equal(startupButton.getAttribute('aria-pressed'), 'false');
startupListeners.get('toolknit-autostart-error')();
await flush();
assert.equal(startupMessages.at(-1), 'settings.autostartError');
startupButton.dispatchEvent(new Event('click'));
await flush();
startup.dispose();
completeWrite();
await flush();
assert.equal(startupButton.getAttribute('aria-pressed'), 'false', 'late writes do not repaint a disposed runtime');
assert.equal(unlistened, 2);
const browserStartup = createAutostartRuntime({ root: startupRoot });
assert.equal(startupButton.disabled, true);
browserStartup.dispose();
}

console.log('Application runtime module contracts passed');
