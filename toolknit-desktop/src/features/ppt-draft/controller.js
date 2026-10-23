import { getLang, onLangChange, t } from '../../i18n.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { enhanceToolSelects } from '../../tool-custom-select.js';
import {
  buildPptDraftPptx,
  PPT_DRAFT_ASSET_LIMITS,
  createPptDraftManifest,
  createPptDraftMarkdown,
  inferPptDraftTheme,
  normalizePptDraftRequest,
  normalizePptDraftAssets,
  normalizePptDraftOutline,
  resolvePptDraftThemeTokens,
  sanitizePptDraftBaseName
} from '../../ppt-draft-core.js';
import {
  buildPptOutlineMessages,
  extractPptOutlineJson,
  normalizePptOutlineResult
} from '../../ppt-outline-core.js';
import {
  getPptAiPreset,
  pptAiGenerationErrorMessage,
  setPptAiPresetActive,
  setPptAiPresetDisabled
} from '../ppt-workflows/ai-shared.js';
import {
  joinPath,
  normalizeDesktopBytes,
  retainBrowserObjectUrl,
  setInteractiveLayer,
  uniqueOutputDirectory,
  writeUniqueFile
} from '../ppt-workflows/shared.js';
import { createPptDraftPreview } from './preview.js';

export function createPptDraftController(context = {}) {
  const overlay = context.overlay;
  const document = overlay?.ownerDocument || globalThis.document;
  const window = document?.defaultView || globalThis.window;
  const featureScope = createLifecycleScope({
    onError: error => console.error('[PptDraft] lifecycle disposal failed:', error)
  });
  const bind = (target, type, listener, options) => {
    if (!target?.addEventListener) return;
    featureScope.event(target, type, listener, options);
  };
  const isTauri = Boolean(context.isTauri);
  const showToast = context.notify || (() => {});
  const getOutputDir = context.getOutputDir || (async () => '');
  const displayFilesystemPath = context.displayFilesystemPath || (value => String(value || ''));
  const getAiApiKey = context.getAiApiKey || (async () => '');
  const callDeepSeek = context.requestAi || (async () => {
    throw new Error(t('common.errorOccurred', { error: 'AI request unavailable' }));
  });
  const initStandardToolPlasma = context.initStandardToolPlasma || (() => null);
  const disposeStandardToolPlasma = context.disposeStandardToolPlasma || (() => null);
  const escapeHtml = value => {
    const element = document?.createElement?.('div');
    if (!element) return String(value ?? '');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  };
  const escapeAttr = value => escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const subscribeLang = context.onLangChange || onLangChange;
let disposed = false;
let sessionRevision = 0;
let sessionScope = null;
  const isCurrentOperation = (revision, controller = null) => Boolean(
    !disposed
    && revision === sessionRevision
    && pptDraftOverlay?.classList.contains('visible')
    && (!controller || pptDraftController === controller)
    && (!controller || !controller.signal.aborted)
  );

// ===== PPT AI Draft / PPTX =====
const pptDraftOverlay = context.overlay || document.getElementById('pptDraftOverlay');
const pptDraftBack = document.getElementById('pptDraftBack');
const pptDraftPlasmaBg = document.getElementById('pptDraftPlasmaBg');
const pptDraftScrollArea = document.getElementById('pptDraftScrollArea');
const pptDraftScrollTop = document.getElementById('pptDraftScrollTop');
const pptDraftPrompt = document.getElementById('pptDraftPrompt');
const pptDraftSlideCount = document.getElementById('pptDraftSlideCount');
const pptDraftLocale = document.getElementById('pptDraftLocale');
const pptDraftDeckType = document.getElementById('pptDraftDeckType');
const pptDraftTheme = document.getElementById('pptDraftTheme');
const pptDraftSelects = enhanceToolSelects([pptDraftLocale, pptDraftDeckType, pptDraftTheme].filter(Boolean));
const refreshPptDraftSelects = () => pptDraftSelects.forEach(select => select.refresh());
featureScope.use(() => pptDraftSelects.forEach(select => select.dispose()));
context.refreshIcons?.();
const pptDraftAudience = document.getElementById('pptDraftAudience');
const pptDraftPurpose = document.getElementById('pptDraftPurpose');
const pptDraftTone = document.getElementById('pptDraftTone');
const pptDraftStyle = document.getElementById('pptDraftStyle');
const pptDraftOutlineImportBtn = document.getElementById('pptDraftOutlineImportBtn');
const pptDraftOutlineClearBtn = document.getElementById('pptDraftOutlineClearBtn');
const pptDraftOutlineFile = document.getElementById('pptDraftOutlineFile');
const pptDraftOutlineStatus = document.getElementById('pptDraftOutlineStatus');
const pptDraftAssetPickBtn = document.getElementById('pptDraftAssetPickBtn');
const pptDraftAssetFile = document.getElementById('pptDraftAssetFile');
const pptDraftAssetList = document.getElementById('pptDraftAssetList');
const pptDraftAssetStatus = document.getElementById('pptDraftAssetStatus');
const pptDraftGenerateBtn = document.getElementById('pptDraftGenerateBtn');
const pptDraftPresetButtons = Array.from(document.querySelectorAll('[data-ppt-draft-preset]'));
const pptDraftEmpty = document.getElementById('pptDraftEmpty');
const pptDraftResult = document.getElementById('pptDraftResult');
const pptDraftSummary = document.getElementById('pptDraftSummary');
const pptDraftSlideList = document.getElementById('pptDraftSlideList');
const pptDraftProcessMask = document.getElementById('pptDraftProcessMask');
const pptDraftProcessBarFill = document.getElementById('pptDraftProcessBarFill');
const pptDraftProcessText = document.getElementById('pptDraftProcessText');
const pptDraftSuccessOverlay = document.getElementById('pptDraftSuccessOverlay');
const pptDraftSuccessMeta = document.getElementById('pptDraftSuccessMeta');
const pptDraftSuccessSlides = document.getElementById('pptDraftSuccessSlides');
const pptDraftSuccessFile = document.getElementById('pptDraftSuccessFile');
const pptDraftSuccessPath = document.getElementById('pptDraftSuccessPath');
const pptDraftSuccessOpenFolder = document.getElementById('pptDraftSuccessOpenFolder');
const pptDraftSuccessOk = document.getElementById('pptDraftSuccessOk');
const pptDraftEditorOverlay = document.getElementById('pptDraftEditorOverlay');
const pptDraftEditorBack = document.getElementById('pptDraftEditorBack');
const pptDraftEditorPlasmaBg = document.getElementById('pptDraftEditorPlasmaBg');
const pptDraftEditorDeckTitle = document.getElementById('pptDraftEditorDeckTitle');
const pptDraftEditorExportBtn = document.getElementById('pptDraftEditorExportBtn');
const pptDraftEditorMoveUpBtn = document.getElementById('pptDraftEditorMoveUpBtn');
const pptDraftEditorMoveDownBtn = document.getElementById('pptDraftEditorMoveDownBtn');
const pptDraftEditorRestoreBtn = document.getElementById('pptDraftEditorRestoreBtn');
const pptDraftEditorStrip = document.getElementById('pptDraftEditorStrip');
const pptDraftEditorCanvas = document.getElementById('pptDraftEditorCanvas');
const pptDraftEditorCurrentPage = document.getElementById('pptDraftEditorCurrentPage');
const pptDraftEditorSlideTitle = document.getElementById('pptDraftEditorSlideTitle');
const pptDraftEditorClaim = document.getElementById('pptDraftEditorClaim');
const pptDraftEditorBullets = document.getElementById('pptDraftEditorBullets');
const pptDraftEditorVisual = document.getElementById('pptDraftEditorVisual');
const pptDraftEditorNote = document.getElementById('pptDraftEditorNote');
let pptDraftPlasmaInstance = null;
let pptDraftEditorPlasmaInstance = null;
const PPT_DRAFT_EDITOR_STATE_KEY = 'toolknit.ppt-draft-editor-state.v1';
let pptDraftBusy = false;
let pptDraftController = null;
let pptDraftLastResult = null;
let pptDraftLastOutputPath = '';
let pptDraftImportedOutline = null;
let pptDraftImportedOutlineSource = '';
let pptDraftAssets = [];
let pptDraftLastPresetPrompt = '';
let pptDraftEditorOutline = null;
let pptDraftEditorOriginalOutline = null;
let pptDraftEditorOriginalSnapshot = '';
let pptDraftEditorOriginalTheme = 'minimal-mono';
let pptDraftEditorSourceSignature = '';
let pptDraftEditorTheme = 'minimal-mono';
let pptDraftEditorSelectedIndex = 0;
let pptDraftEditorExporting = false;
let pptDraftEditorAutosaveTimer = null;
let pptDraftEditorDragIndex = -1;
let pptDraftEditorDropTargetIndex = -1;
const pptDraftEditorModal = createModalSession({
  root: pptDraftEditorOverlay,
  background: pptDraftOverlay,
  initialFocus: pptDraftEditorSlideTitle,
  onClose: () => closePptDraftEditor(),
  canClose: () => !pptDraftEditorExporting,
  documentRef: document
});
featureScope.use(() => pptDraftEditorModal.dispose());

function pptDraftText(key, params) {
  return t(`home.pptDraftPage.${key}`, params);
}

const pptDraftPreview = createPptDraftPreview({
  elements: {
    empty: pptDraftEmpty,
    result: pptDraftResult,
    summary: pptDraftSummary,
    slideList: pptDraftSlideList
  },
  text: pptDraftText,
  onResult: result => { pptDraftLastResult = result; }
});
const {
  pptDraftInline,
  pptDraftPreviewCanvas,
  pptDraftPreviewLabel,
  pptDraftThemeLabel,
  renderPptDraftResult
} = pptDraftPreview;

function updatePptDraftOutlineStatus(message, isReady = false) {
  if (!pptDraftOutlineStatus) return;
  pptDraftOutlineStatus.textContent = message || pptDraftText('outlineImportHint');
  pptDraftOutlineStatus.dataset.ready = isReady ? 'true' : 'false';
}

function setPptDraftProgress(percent, message, visible = true) {
  if (pptDraftProcessBarFill) pptDraftProcessBarFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (pptDraftProcessText) pptDraftProcessText.textContent = message || pptDraftText('processing');
  setInteractiveLayer(pptDraftProcessMask, visible);
}

function updatePptDraftScrollTop() {
  if (!pptDraftScrollArea || !pptDraftScrollTop) return;
  pptDraftScrollTop.classList.toggle('visible', pptDraftScrollArea.scrollTop > 160);
}

function applyPptDraftPreset(key) {
  if (pptDraftBusy) {
    showToast(pptDraftText('processing'));
    return;
  }
  const preset = getPptAiPreset(key);
  if (!preset) return;
  const currentPrompt = String(pptDraftPrompt?.value || '').trim();
  const shouldReplacePrompt = !currentPrompt || currentPrompt === pptDraftLastPresetPrompt;
  if (pptDraftPrompt && shouldReplacePrompt) {
    pptDraftPrompt.value = preset.prompt;
    pptDraftLastPresetPrompt = preset.prompt;
  } else {
    pptDraftLastPresetPrompt = '';
  }
  if (pptDraftSlideCount) pptDraftSlideCount.value = String(preset.slideCount);
  if (pptDraftDeckType) pptDraftDeckType.value = preset.deckType;
  if (pptDraftTheme) pptDraftTheme.value = preset.theme;
  if (pptDraftAudience) pptDraftAudience.value = preset.audience;
  if (pptDraftPurpose) pptDraftPurpose.value = preset.purpose;
  if (pptDraftTone) pptDraftTone.value = preset.tone;
  if (pptDraftStyle) pptDraftStyle.value = preset.style;
  refreshPptDraftSelects();
  setPptAiPresetActive(pptDraftPresetButtons, 'pptDraftPreset', key);
  showToast(pptDraftText(shouldReplacePrompt ? 'presetAppliedToast' : 'presetAppliedKeepPromptToast', { name: preset.name }));
}

function resetPptDraftState({ clearPrompt = false } = {}) {
  pptDraftBusy = false;
  pptDraftController?.abort();
  pptDraftController = null;
  pptDraftLastResult = null;
  pptDraftLastOutputPath = '';
  clearPptDraftAssets();
  if (clearPrompt && pptDraftPrompt) {
    pptDraftPrompt.value = '';
    pptDraftLastPresetPrompt = '';
    setPptAiPresetActive(pptDraftPresetButtons, 'pptDraftPreset', '');
  }
  if (clearPrompt) {
    if (pptDraftAudience) pptDraftAudience.value = '';
    if (pptDraftPurpose) pptDraftPurpose.value = '';
    if (pptDraftTone) pptDraftTone.value = '';
    if (pptDraftStyle) pptDraftStyle.value = '';
    if (pptDraftSlideCount) pptDraftSlideCount.value = '8';
    if (pptDraftDeckType) pptDraftDeckType.value = 'auto';
    if (pptDraftTheme) pptDraftTheme.value = 'minimal-mono';
  }
  if (pptDraftLocale) pptDraftLocale.value = getLang() === 'en' ? 'en' : 'zh-CN';
  pptDraftSelects.forEach(select => select.close());
  refreshPptDraftSelects();
  if (pptDraftEmpty) pptDraftEmpty.hidden = false;
  if (pptDraftResult) pptDraftResult.hidden = true;
  if (pptDraftSummary) pptDraftSummary.innerHTML = '';
  if (pptDraftSlideList) pptDraftSlideList.innerHTML = '';
  if (pptDraftGenerateBtn) pptDraftGenerateBtn.disabled = false;
  if (pptDraftOutlineImportBtn) pptDraftOutlineImportBtn.disabled = false;
  if (pptDraftOutlineClearBtn) pptDraftOutlineClearBtn.disabled = !pptDraftImportedOutline;
  setPptAiPresetDisabled(pptDraftPresetButtons, false);
  pptDraftScrollTop?.classList.remove('visible');
  setInteractiveLayer(pptDraftSuccessOverlay, false);
  setPptDraftProgress(0, pptDraftText('processing'), false);
}

function retainPptDraftPreviewUrl(url) {
  if (!url || !sessionScope || typeof globalThis.URL?.revokeObjectURL !== 'function') return;
  sessionScope.use(() => globalThis.URL.revokeObjectURL(url));
}

function pptDraftAssetMime(name, value = '') {
  const explicit = String(value || '').toLowerCase().split(';')[0].trim();
  if (PPT_DRAFT_ASSET_LIMITS.supportedMimeTypes.includes(explicit)) return explicit;
  const extension = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  return extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : '';
}

async function readPptDraftAssetDimensions(previewUrl) {
  if (!previewUrl || !window?.Image) return { width: 0, height: 0 };
  return new Promise(resolve => {
    const image = new window.Image();
    let settled = false;
    const finish = (width = 0, height = 0) => {
      if (settled) return;
      settled = true;
      resolve({ width: Number(width) || 0, height: Number(height) || 0 });
    };
    image.onload = () => finish(image.naturalWidth, image.naturalHeight);
    image.onerror = () => finish();
    image.src = previewUrl;
    featureScope.timeout(() => finish(), 2500);
  });
}

async function readPptDraftAssetFile(file) {
  const name = String(file?.name || file?.path || '').split(/[\\/]/).pop() || 'image';
  const mime = pptDraftAssetMime(name, file?.type);
  if (!mime) throw new Error(pptDraftText('assetUnsupported'));
  let bytes;
  if (isTauri && file?.path) {
    const { invoke } = await tauriCorePromise;
    bytes = normalizeDesktopBytes(await invoke('read_file_bytes_limited', {
      path: file.path,
      maxBytes: PPT_DRAFT_ASSET_LIMITS.maxBytesPerAsset
    }));
  } else if (typeof file?.arrayBuffer === 'function') {
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    throw new Error(pptDraftText('assetReadFailed'));
  }
  if (!bytes.byteLength) throw new Error(pptDraftText('assetReadFailed'));
  if (bytes.byteLength > PPT_DRAFT_ASSET_LIMITS.maxBytesPerAsset) throw new Error(pptDraftText('assetTooLarge'));
  const previewUrl = typeof globalThis.URL?.createObjectURL === 'function'
    ? globalThis.URL.createObjectURL(new Blob([bytes], { type: mime }))
    : '';
  retainPptDraftPreviewUrl(previewUrl);
  const dimensions = await readPptDraftAssetDimensions(previewUrl);
  return {
    id: name.replace(/\.[^.]+$/, ''),
    name,
    mime,
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    preview_url: previewUrl
  };
}

function renderPptDraftAssets() {
  if (pptDraftAssetStatus) {
    pptDraftAssetStatus.textContent = pptDraftAssets.length
      ? pptDraftText('assetStatus', { count: pptDraftAssets.length, max: PPT_DRAFT_ASSET_LIMITS.maxAssets })
      : pptDraftText('assetEmpty');
  }
  if (!pptDraftAssetList) return;
  pptDraftAssetList.innerHTML = pptDraftAssets.map(asset => `
    <div class="ppt-draft-asset-item">
      <div class="ppt-draft-asset-thumb${asset.preview_url ? '' : ' is-empty'}">
        ${asset.preview_url ? `<img src="${escapeAttr(asset.preview_url)}" alt="${escapeAttr(asset.name)}" draggable="false">` : '<i data-lucide="image-off" aria-hidden="true"></i>'}
      </div>
      <div class="ppt-draft-asset-copy">
        <strong title="${escapeAttr(asset.name)}">${escapeHtml(asset.name)}</strong>
        <span>${asset.width && asset.height ? `${asset.width} × ${asset.height}` : pptDraftText('assetDimensionsUnknown')} · ${Math.max(1, Math.round(asset.size / 1024))} KB</span>
      </div>
      <button class="ppt-draft-asset-remove" type="button" data-ppt-draft-asset-remove="${escapeAttr(asset.id)}" aria-label="${escapeAttr(pptDraftText('assetRemove'))}" title="${escapeAttr(pptDraftText('assetRemove'))}"><i data-lucide="x"></i></button>
    </div>
  `).join('');
  window.lucide?.createIcons?.({ attrs: { 'stroke-width': 1.8 } });
}

function clearPptDraftAssets() {
  pptDraftAssets.forEach(asset => {
    if (asset.preview_url && typeof globalThis.URL?.revokeObjectURL === 'function') globalThis.URL.revokeObjectURL(asset.preview_url);
  });
  pptDraftAssets = [];
  renderPptDraftAssets();
  if (pptDraftAssetFile) pptDraftAssetFile.value = '';
}

function removePptDraftAsset(id) {
  const target = pptDraftAssets.find(asset => asset.id === id);
  if (target?.preview_url && typeof globalThis.URL?.revokeObjectURL === 'function') globalThis.URL.revokeObjectURL(target.preview_url);
  pptDraftAssets = pptDraftAssets.filter(asset => asset.id !== id);
  renderPptDraftAssets();
}

async function addPptDraftAssetFiles(files) {
  if (pptDraftBusy) return;
  const incoming = Array.from(files || []).slice(0, PPT_DRAFT_ASSET_LIMITS.maxAssets - pptDraftAssets.length);
  if (!incoming.length) {
    showToast(pptDraftText('assetLimit', { max: PPT_DRAFT_ASSET_LIMITS.maxAssets }));
    return;
  }
  const loaded = [];
  try {
    for (const file of incoming) loaded.push(await readPptDraftAssetFile(file));
    const normalized = normalizePptDraftAssets([...pptDraftAssets, ...loaded]);
    if (normalized.length < pptDraftAssets.length + loaded.length) showToast(pptDraftText('assetLimit', { max: PPT_DRAFT_ASSET_LIMITS.maxAssets }));
    pptDraftAssets = normalized;
    renderPptDraftAssets();
  } catch (error) {
    loaded.forEach(asset => {
      if (asset.preview_url && typeof globalThis.URL?.revokeObjectURL === 'function') globalThis.URL.revokeObjectURL(asset.preview_url);
    });
    showToast(String(error?.userMessage || error?.message || error));
  }
}

async function choosePptDraftAssetFiles() {
  if (pptDraftBusy) return;
  try {
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
        title: getLang() === 'en' ? 'Add PPT image assets' : '添加 PPT 图片素材'
      });
      const paths = Array.isArray(selected) ? selected : (typeof selected === 'string' ? [selected] : []);
      await addPptDraftAssetFiles(paths.map(path => ({ path, name: String(path).split(/[\\/]/).pop() || path })));
      return;
    }
    pptDraftAssetFile?.click();
  } catch (error) {
    console.error('Choose PPT draft assets failed:', error);
    showToast(String(error?.userMessage || error?.message || error));
  }
}

function clearPptDraftImportedOutline() {
  pptDraftImportedOutline = null;
  pptDraftImportedOutlineSource = '';
  if (pptDraftOutlineFile) pptDraftOutlineFile.value = '';
  if (pptDraftOutlineImportBtn) pptDraftOutlineImportBtn.textContent = pptDraftText('outlineImportBtn');
  if (pptDraftOutlineClearBtn) pptDraftOutlineClearBtn.disabled = true;
  if (pptDraftOutlineImportBtn) pptDraftOutlineImportBtn.disabled = false;
  updatePptDraftOutlineStatus(pptDraftText('outlineImportHint'), false);
}

function pptDraftFirstValue(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function pptDraftKnownTheme(value = 'minimal-mono') {
  const candidate = String(value || '').trim();
  return ['minimal-mono', 'minimal-dark', 'minimal-light', 'tech-blue'].includes(candidate)
    ? candidate
    : 'minimal-mono';
}

function pptDraftSelectHasValue(select, value) {
  return Boolean(select && Array.from(select.options || []).some(option => option.value === value));
}

function pptDraftOutlineObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pptDraftOutlineRequestSeed(payload = {}, fallback = {}) {
  const draftRequest = pptDraftOutlineObject(payload?.draft_request);
  const sourceRequest = pptDraftOutlineObject(payload?.request);
  const design = pptDraftOutlineObject(payload?.design);
  const prompt = pptDraftFirstValue(
    draftRequest.prompt,
    sourceRequest.prompt,
    payload?.prompt,
    payload?.title,
    fallback.prompt
  );
  const audience = pptDraftFirstValue(draftRequest.audience, sourceRequest.audience, payload?.audience, fallback.audience);
  const purpose = pptDraftFirstValue(draftRequest.purpose, sourceRequest.purpose, payload?.purpose, fallback.purpose);
  const tone = pptDraftFirstValue(draftRequest.tone, sourceRequest.tone, fallback.tone);
  const style = pptDraftFirstValue(draftRequest.style, sourceRequest.style, design.style, design.visual_system, fallback.style);
  const inferredTheme = inferPptDraftTheme({
    prompt,
    audience,
    purpose,
    tone,
    style,
    theme_hint: pptDraftFirstValue(design.theme, design.color_hint, design.visual_system)
  });
  const theme = pptDraftKnownTheme(
    pptDraftFirstValue(draftRequest.theme, sourceRequest.theme, design.theme, inferredTheme, fallback.theme),
    'minimal-mono'
  );
  return {
    prompt,
    slide_count: Number(draftRequest.slide_count || sourceRequest.slide_count || payload?.slides?.length || fallback.slide_count || 8),
    locale: pptDraftFirstValue(draftRequest.locale, sourceRequest.locale, fallback.locale, getLang() === 'en' ? 'en' : 'zh-CN'),
    deck_type: pptDraftFirstValue(draftRequest.deck_type, sourceRequest.deck_type, payload?.deck_type, fallback.deck_type, 'auto'),
    audience,
    purpose,
    tone,
    style,
    theme
  };
}

function syncPptDraftImportedOutline(normalized, sourceLabel = '') {
  pptDraftImportedOutline = normalized;
  pptDraftImportedOutlineSource = sourceLabel;
  const seed = pptDraftOutlineRequestSeed(normalized, {
    prompt: pptDraftPrompt?.value || '',
    theme: pptDraftTheme?.value || 'minimal-mono',
    locale: pptDraftLocale?.value || (getLang() === 'en' ? 'en' : 'zh-CN'),
    deck_type: pptDraftDeckType?.value || 'auto',
    audience: pptDraftAudience?.value || '',
    purpose: pptDraftPurpose?.value || '',
    tone: pptDraftTone?.value || '',
    style: pptDraftStyle?.value || ''
  });
  if (pptDraftPrompt && seed.prompt) pptDraftPrompt.value = seed.prompt;
  if (pptDraftSlideCount && normalized?.slides?.length) {
    pptDraftSlideCount.value = String(normalized.slides.length);
  }
  if (pptDraftDeckType) {
    pptDraftDeckType.value = seed.deck_type || 'auto';
  }
  if (pptDraftTheme && pptDraftSelectHasValue(pptDraftTheme, seed.theme)) pptDraftTheme.value = seed.theme;
  if (pptDraftLocale && seed.locale) pptDraftLocale.value = seed.locale;
  if (pptDraftAudience) pptDraftAudience.value = seed.audience || '';
  if (pptDraftPurpose) pptDraftPurpose.value = seed.purpose || '';
  if (pptDraftTone) pptDraftTone.value = seed.tone || '';
  if (pptDraftStyle) pptDraftStyle.value = seed.style || '';
  refreshPptDraftSelects();
  if (pptDraftOutlineImportBtn) {
    pptDraftOutlineImportBtn.textContent = pptDraftText('outlineImportBtnImported');
  }
  if (pptDraftOutlineClearBtn) pptDraftOutlineClearBtn.disabled = false;
  const slides = normalized?.slides?.length || 0;
  const label = normalized?.title || '';
  const source = sourceLabel ? ` · ${sourceLabel}` : '';
  updatePptDraftOutlineStatus(
    pptDraftText('outlineImported', { slides, title: label || pptDraftText('title') }) + source,
    true
  );
}

function applyPptDraftOutlineDefaults(normalized) {
  if (!normalized) return normalized;
  if (pptDraftSlideCount && normalized?.slides?.length) {
    pptDraftSlideCount.value = String(normalized.slides.length);
  }
  if (pptDraftDeckType) {
    pptDraftDeckType.value = normalized.request?.deck_type || normalized.deck_type || 'auto';
  }
  refreshPptDraftSelects();
  return normalized;
}

async function readPptDraftOutlineFile(file) {
  if (!file) throw new Error('ppt-draft-outline:missing-file');
  const name = String(file.name || file.path || '').trim();
  if (!/\.json$/i.test(name)) {
    throw new Error('ppt-draft-outline:invalid-extension');
  }
  let text = '';
  if (isTauri && file.path) {
    const { invoke } = await tauriCorePromise;
    const rawBytes = await invoke('read_file_bytes_limited', {
      path: file.path,
      maxBytes: 4 * 1024 * 1024
    });
    text = new TextDecoder('utf-8').decode(normalizeDesktopBytes(rawBytes));
  } else if (typeof file.text === 'function') {
    text = await file.text();
  } else {
    throw new Error('ppt-draft-outline:unsupported-file');
  }
  const payload = JSON.parse(text);
  const seed = pptDraftOutlineRequestSeed(payload, {
    prompt: pptDraftPrompt?.value || '',
    theme: pptDraftTheme?.value || 'minimal-mono',
    locale: pptDraftLocale?.value || (getLang() === 'en' ? 'en' : 'zh-CN'),
    deck_type: pptDraftDeckType?.value || 'auto',
    audience: pptDraftAudience?.value || '',
    purpose: pptDraftPurpose?.value || '',
    tone: pptDraftTone?.value || '',
    style: pptDraftStyle?.value || ''
  });
  const normalized = applyPptDraftOutlineDefaults(normalizePptDraftOutline(payload, {
    ...seed
  }));
  return { normalized, name };
}

async function choosePptDraftOutlineFile() {
  if (pptDraftBusy) return;
  try {
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: getLang() === 'en' ? 'Import PPT outline.json' : '导入 PPT 大纲 outline.json'
      });
      if (typeof selected === 'string') {
        const file = { path: selected, name: selected.split(/[\\/]/).pop() || selected };
        const { normalized, name } = await readPptDraftOutlineFile(file);
        syncPptDraftImportedOutline(normalized, name);
      }
      return;
    }
    pptDraftOutlineFile?.click();
  } catch (error) {
    console.error('Choose PPT outline failed:', error);
    showToast(String(error?.userMessage || error?.message || error));
  }
}

async function handlePptDraftOutlineFileInput(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    const { normalized, name } = await readPptDraftOutlineFile(file);
    syncPptDraftImportedOutline(normalized, name);
  } catch (error) {
    console.error('Load PPT outline failed:', error);
    showToast(pptAiGenerationErrorMessage(error, pptDraftText));
  } finally {
    if (pptDraftOutlineFile) pptDraftOutlineFile.value = '';
  }
}

function openPptDraftOverlay() {
  if (disposed || !pptDraftOverlay) return;
  if (!pptDraftOverlay.classList.contains('visible')) {
    sessionRevision += 1;
    sessionScope?.dispose();
    sessionScope = createLifecycleScope({
      onError: error => console.error('[PptDraft] session disposal failed:', error)
    });
  }
  pptDraftOverlay.classList.add('visible');
  pptDraftOverlay.setAttribute('aria-hidden', 'false');
  pptDraftGenerateBtn?.classList.add('visible');
  pptDraftOutlineImportBtn?.classList.add('visible');
  if (pptDraftScrollArea) pptDraftScrollArea.scrollTop = 0;
  updatePptDraftScrollTop();
  if (pptDraftLocale) pptDraftLocale.value = getLang() === 'en' ? 'en' : 'zh-CN';
  if (pptDraftDeckType) pptDraftDeckType.value = pptDraftDeckType.value || 'auto';
  refreshPptDraftSelects();
  if (pptDraftOutlineClearBtn) pptDraftOutlineClearBtn.disabled = !pptDraftImportedOutline;
  updatePptDraftOutlineStatus(
    pptDraftImportedOutline
      ? `${pptDraftText('outlineImported', { slides: pptDraftImportedOutline.slides?.length || 0, title: pptDraftImportedOutline.title || pptDraftText('title') })}${pptDraftImportedOutlineSource ? ` · ${pptDraftImportedOutlineSource}` : ''}`
      : pptDraftText('outlineImportHint'),
    Boolean(pptDraftImportedOutline)
  );
  if (pptDraftPlasmaBg && !pptDraftPlasmaInstance) {
    pptDraftPlasmaInstance = initStandardToolPlasma(pptDraftPlasmaBg);
  }
  featureScope.timeout(() => {
    if (!disposed && pptDraftOverlay.classList.contains('visible')) pptDraftPrompt?.focus();
  }, 80);
}

function closePptDraftOverlay() {
  if (!pptDraftOverlay) return;
  sessionRevision += 1;
  const owner = sessionScope;
  sessionScope = null;
  owner?.dispose();
  pptDraftController?.abort();
  pptDraftController = null;
  pptDraftBusy = false;
  closePptDraftEditor({ force: true, restore: false });
  pptDraftOverlay.classList.remove('visible');
  pptDraftOverlay.setAttribute('aria-hidden', 'true');
  pptDraftPlasmaInstance = disposeStandardToolPlasma(pptDraftPlasmaInstance);
  resetPptDraftState({ clearPrompt: false });
}

function collectPptDraftRequest() {
  const prompt = String(pptDraftPrompt?.value || '').trim();
  if (!prompt && !pptDraftImportedOutline) {
    showToast(pptDraftText('promptRequired'));
    pptDraftPrompt?.focus();
    return null;
  }
  const audience = String(pptDraftAudience?.value || '').trim();
  const purpose = String(pptDraftPurpose?.value || '').trim();
  const tone = String(pptDraftTone?.value || '').trim();
  const style = String(pptDraftStyle?.value || '').trim();
  const slideCount = Number(pptDraftSlideCount?.value || 8);
  if (!Number.isSafeInteger(slideCount) || slideCount < 3 || slideCount > 30) {
    showToast(pptDraftText('slideCountInvalid'));
    pptDraftSlideCount?.focus();
    return null;
  }
  const theme = pptDraftTheme?.value || 'minimal-mono';
  try {
    return normalizePptDraftRequest({
      prompt,
      slide_count: slideCount,
      locale: pptDraftLocale?.value || (getLang() === 'en' ? 'en' : 'zh-CN'),
      deck_type: pptDraftDeckType?.value || 'auto',
      theme,
      audience,
      purpose,
      tone,
      style
    });
  } catch (error) {
    showToast(String(error?.userMessage || error?.message || error));
    return null;
  }
}

function pptDraftOutputBaseName(outline) {
  return sanitizePptDraftBaseName(outline?.title || pptDraftText('title') || 'ppt-draft');
}

async function getPptDraftOutputDirectory(baseName) {
  return uniqueOutputDirectory({
    getOutputDir,
    isTauri,
    category: 'PPT_Draft',
    baseName: `${sanitizePptDraftBaseName(baseName)}_ppt_draft`
  });
}


function clonePptDraftOutline(outline) {
  try {
    return JSON.parse(JSON.stringify(outline || {}));
  } catch {
    return null;
  }
}

function pptDraftEditorSignature(outline = pptDraftEditorOutline, theme = pptDraftEditorTheme) {
  const payload = JSON.stringify({
    outline: outline || null,
    theme: String(theme || '')
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ppt-draft:${hash.toString(16).padStart(8, '0')}`;
}

function clearPptDraftEditorDropTarget() {
  if (!pptDraftEditorStrip) return;
  pptDraftEditorStrip.querySelectorAll('.ppt-draft-editor-thumb.drop-target').forEach(item => item.classList.remove('drop-target'));
  pptDraftEditorDropTargetIndex = -1;
}

function updatePptDraftEditorActionState() {
  const slides = pptDraftEditorSlides();
  const canMoveUp = pptDraftEditorSelectedIndex > 0 && slides.length > 1;
  const canMoveDown = pptDraftEditorSelectedIndex >= 0 && pptDraftEditorSelectedIndex < slides.length - 1;
  if (pptDraftEditorMoveUpBtn) pptDraftEditorMoveUpBtn.disabled = !canMoveUp;
  if (pptDraftEditorMoveDownBtn) pptDraftEditorMoveDownBtn.disabled = !canMoveDown;
  if (pptDraftEditorRestoreBtn) pptDraftEditorRestoreBtn.disabled = !pptDraftEditorOriginalOutline || !slides.length;
}

function readPptDraftEditorState() {
  try {
    const state = JSON.parse(localStorage.getItem(PPT_DRAFT_EDITOR_STATE_KEY) || 'null');
    if (!state || typeof state !== 'object') return null;
    return state;
  } catch {
    return null;
  }
}

function writePptDraftEditorState() {
  if (!pptDraftEditorOutline) return;
  try {
    localStorage.setItem(PPT_DRAFT_EDITOR_STATE_KEY, JSON.stringify({
      signature: pptDraftEditorSourceSignature || pptDraftEditorSignature(),
      outline: pptDraftEditorOutline,
      theme: pptDraftEditorTheme,
      selectedIndex: pptDraftEditorSelectedIndex,
      savedAt: new Date().toISOString()
    }));
  } catch {}
}

function clearPptDraftEditorState() {
  try {
    localStorage.removeItem(PPT_DRAFT_EDITOR_STATE_KEY);
  } catch {}
}

function schedulePptDraftEditorStateSave() {
  if (pptDraftEditorAutosaveTimer) {
    window.clearTimeout(pptDraftEditorAutosaveTimer);
  }
  pptDraftEditorAutosaveTimer = window.setTimeout(() => {
    pptDraftEditorAutosaveTimer = null;
    writePptDraftEditorState();
  }, 180);
}

function pptDraftEditorSlides() {
  return Array.isArray(pptDraftEditorOutline?.slides) ? pptDraftEditorOutline.slides : [];
}

function clampPptDraftEditorIndex(index) {
  const slides = pptDraftEditorSlides();
  if (!slides.length) return 0;
  const value = Number(index);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(slides.length - 1, Math.trunc(value)));
}

function syncPptDraftEditorFormToSlide() {
  const slides = pptDraftEditorSlides();
  const slide = slides[pptDraftEditorSelectedIndex];
  if (!slide) return;
  const title = pptDraftInline(pptDraftEditorSlideTitle?.value, slide.title || `Slide ${pptDraftEditorSelectedIndex + 1}`, 120);
  const claim = pptDraftInline(pptDraftEditorClaim?.value, '', 180);
  const bullets = String(pptDraftEditorBullets?.value || '')
    .split(/\r?\n/)
    .map(item => pptDraftInline(item.replace(/^[•\-\d.\s]+/, ''), '', 120))
    .filter(Boolean)
    .slice(0, 5);
  const visual = pptDraftInline(pptDraftEditorVisual?.value, '', 180);
  const note = pptDraftInline(pptDraftEditorNote?.value, '', 240);
  slide.title = title;
  slide.claim = claim;
  slide.body = bullets.length ? bullets : [pptDraftPreviewLabel('fallbackBullet')];
  slide.visual_suggestion = visual;
  if (!slide.layout_intent || typeof slide.layout_intent !== 'object' || Array.isArray(slide.layout_intent)) {
    slide.layout_intent = {};
  }
  if (visual) slide.layout_intent.visual_focus = visual;
  slide.speaker_note = note;
}

function applyPptDraftEditorSavedState() {
  const saved = readPptDraftEditorState();
  if (!saved || !saved.outline) return;
  if (saved.signature !== pptDraftEditorSourceSignature) return;
  const restored = clonePptDraftOutline(saved.outline);
  if (!restored) return;
  pptDraftEditorOutline = restored;
  pptDraftEditorTheme = saved.theme || pptDraftEditorTheme;
  pptDraftEditorSelectedIndex = clampPptDraftEditorIndex(saved.selectedIndex);
}

function renderPptDraftEditorNavigation() {
  const slides = pptDraftEditorSlides();
  if (pptDraftEditorDeckTitle) pptDraftEditorDeckTitle.textContent = pptDraftEditorOutline?.title || '';
  if (pptDraftEditorStrip) {
    pptDraftEditorStrip.innerHTML = slides.map((slide, index) => `
      <button class="ppt-draft-editor-thumb${index === pptDraftEditorSelectedIndex ? ' active' : ''}" type="button" draggable="true" data-ppt-draft-editor-index="${escapeAttr(String(index))}">
        <span class="ppt-draft-editor-thumb-num">${escapeHtml(String(index + 1).padStart(2, '0'))}</span>
        <span class="ppt-draft-editor-thumb-title">${escapeHtml(pptDraftInline(slide.title, `Slide ${index + 1}`, 80))}</span>
      </button>
    `).join('');
    window.requestAnimationFrame(() => {
      const active = pptDraftEditorStrip.querySelector(`[data-ppt-draft-editor-index="${pptDraftEditorSelectedIndex}"]`);
      active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  updatePptDraftEditorActionState();
}

function renderPptDraftEditorPreview() {
  const slides = pptDraftEditorSlides();
  const slide = slides[pptDraftEditorSelectedIndex];
  if (!slide) {
    if (pptDraftEditorCanvas) pptDraftEditorCanvas.innerHTML = '';
    if (pptDraftEditorCurrentPage) pptDraftEditorCurrentPage.textContent = '';
    return;
  }
  if (pptDraftEditorCurrentPage) {
    pptDraftEditorCurrentPage.textContent = pptDraftText('editorPage', {
      page: String(pptDraftEditorSelectedIndex + 1),
      total: String(slides.length)
    });
  }
  if (pptDraftEditorCanvas) {
    pptDraftEditorCanvas.innerHTML = pptDraftPreviewCanvas(
      slide,
      pptDraftEditorSelectedIndex,
      slides.length,
      pptDraftEditorOutline,
      pptDraftEditorTheme,
      {
        slideIndex: pptDraftEditorSelectedIndex + 1,
        assets: pptDraftLastResult?.assets || [],
        assetManifest: pptDraftLastResult?.asset_manifest || pptDraftEditorOutline.asset_manifest || []
      }
    );
  }
}

function loadPptDraftEditorForm() {
  const slide = pptDraftEditorSlides()[pptDraftEditorSelectedIndex];
  if (!slide) return;
  if (pptDraftEditorSlideTitle) pptDraftEditorSlideTitle.value = slide.title || '';
  if (pptDraftEditorClaim) pptDraftEditorClaim.value = slide.claim || '';
  if (pptDraftEditorBullets) pptDraftEditorBullets.value = (Array.isArray(slide.body) ? slide.body : []).join('\n');
  if (pptDraftEditorVisual) pptDraftEditorVisual.value = slide.visual_suggestion || slide.layout_intent?.visual_focus || '';
  if (pptDraftEditorNote) pptDraftEditorNote.value = slide.speaker_note || '';
}

function renderPptDraftEditor() {
  renderPptDraftEditorNavigation();
  renderPptDraftEditorPreview();
  loadPptDraftEditorForm();
  schedulePptDraftEditorStateSave();
  updatePptDraftEditorActionState();
}

function movePptDraftEditorSlideToIndex(targetIndex) {
  syncPptDraftEditorFormToSlide();
  const slides = pptDraftEditorSlides();
  if (slides.length < 2) return;
  const from = pptDraftEditorSelectedIndex;
  const to = Math.max(0, Math.min(slides.length - 1, Math.trunc(Number(targetIndex))));
  if (to === from || !Number.isFinite(to)) return;
  const [moved] = slides.splice(from, 1);
  const insertionIndex = to;
  slides.splice(insertionIndex, 0, moved);
  pptDraftEditorSelectedIndex = insertionIndex;
  renderPptDraftEditor();
  schedulePptDraftEditorStateSave();
}

function movePptDraftEditorSlide(direction) {
  movePptDraftEditorSlideToIndex(pptDraftEditorSelectedIndex + direction);
}

function restorePptDraftEditorOriginal() {
  if (!pptDraftEditorOriginalOutline && !pptDraftEditorOriginalSnapshot) {
    showToast(pptDraftText('editorNeedDraft'));
    return;
  }
  let restored = null;
  try {
    restored = pptDraftEditorOriginalSnapshot
      ? JSON.parse(pptDraftEditorOriginalSnapshot)
      : clonePptDraftOutline(pptDraftEditorOriginalOutline)
        || (pptDraftLastResult?.outline ? clonePptDraftOutline(pptDraftLastResult.outline) : null);
  } catch {
    restored = clonePptDraftOutline(pptDraftEditorOriginalOutline);
  }
  if (!restored) return;
  clearPptDraftEditorState();
  pptDraftEditorOutline = restored;
  pptDraftEditorTheme = pptDraftEditorOriginalTheme || pptDraftEditorTheme;
  pptDraftEditorSelectedIndex = clampPptDraftEditorIndex(pptDraftEditorSelectedIndex);
  renderPptDraftEditor();
  schedulePptDraftEditorStateSave();
  showToast(pptDraftText('editorRestoredToast'));
}

function openPptDraftEditor(index = 0) {
  if (!pptDraftLastResult?.outline) {
    showToast(pptDraftText('editorNeedDraft'));
    return;
  }
  pptDraftEditorOriginalOutline = clonePptDraftOutline(pptDraftLastResult.outline);
  if (!pptDraftEditorOriginalOutline) {
    showToast(pptDraftText('invalidAiResponse'));
    return;
  }
  pptDraftEditorOriginalSnapshot = JSON.stringify(pptDraftEditorOriginalOutline);
  pptDraftEditorOriginalTheme = pptDraftLastResult.theme || pptDraftEditorOriginalOutline.request?.theme || 'minimal-mono';
  pptDraftEditorSourceSignature = pptDraftEditorSignature(pptDraftEditorOriginalOutline, pptDraftEditorOriginalTheme);
  pptDraftEditorOutline = clonePptDraftOutline(pptDraftEditorOriginalOutline);
  pptDraftEditorTheme = pptDraftEditorOriginalTheme;
  pptDraftEditorSelectedIndex = clampPptDraftEditorIndex(index);
  applyPptDraftEditorSavedState();
  if (pptDraftEditorPlasmaBg && !pptDraftEditorPlasmaInstance) {
    pptDraftEditorPlasmaInstance = initStandardToolPlasma(pptDraftEditorPlasmaBg);
  }
  renderPptDraftEditor();
  pptDraftEditorModal.open();
}

function closePptDraftEditor({ force = false, restore = true } = {}) {
  if (!pptDraftEditorOverlay) return;
  if (pptDraftEditorExporting && !force) {
    showToast(pptDraftText('editorExporting'));
    return;
  }
  if (pptDraftEditorAutosaveTimer) {
    window.clearTimeout(pptDraftEditorAutosaveTimer);
    pptDraftEditorAutosaveTimer = null;
  }
  if (pptDraftEditorOutline) {
    writePptDraftEditorState();
  }
  pptDraftEditorModal.close({ restore });
  pptDraftEditorPlasmaInstance = disposeStandardToolPlasma(pptDraftEditorPlasmaInstance);
}

function selectPptDraftEditorSlide(index) {
  syncPptDraftEditorFormToSlide();
  pptDraftEditorSelectedIndex = clampPptDraftEditorIndex(index);
  renderPptDraftEditor();
  schedulePptDraftEditorStateSave();
}

function updatePptDraftEditorCurrentSlide() {
  syncPptDraftEditorFormToSlide();
  renderPptDraftEditorNavigation();
  renderPptDraftEditorPreview();
  schedulePptDraftEditorStateSave();
}

async function exportPptDraftEditorResult() {
  if (pptDraftEditorExporting) return;
  if (!pptDraftEditorOutline) {
    showToast(pptDraftText('editorNeedDraft'));
    return;
  }
  syncPptDraftEditorFormToSlide();
  pptDraftEditorExporting = true;
  const originalLabel = pptDraftEditorExportBtn?.textContent || '';
  if (pptDraftEditorExportBtn) {
    pptDraftEditorExportBtn.disabled = true;
    pptDraftEditorExportBtn.textContent = pptDraftText('editorExporting');
  }
  try {
    const draft = await buildPptDraftPptx(pptDraftEditorOutline, {
      theme: pptDraftEditorTheme,
      request: {
        ...(pptDraftEditorOutline.request || {}),
        theme: pptDraftEditorTheme
      },
      assets: pptDraftAssets
    });
    renderPptDraftResult(draft);
    const exported = await exportPptDraftResult(draft);
    showToast(pptDraftText('editorExportedToast', { slides: draft.outline.slides.length }));
    closePptDraftEditor({ force: true });
    writePptDraftEditorState();
    showPptDraftSuccess(exported.output_dir, exported);
  } catch (error) {
    console.error('Export edited PPT draft failed:', error);
    showToast(pptAiGenerationErrorMessage(error, pptDraftText));
  } finally {
    pptDraftEditorExporting = false;
    if (pptDraftEditorExportBtn) {
      pptDraftEditorExportBtn.disabled = false;
      pptDraftEditorExportBtn.textContent = originalLabel || pptDraftText('editorExport');
    }
  }
}

async function exportPptDraftResult(draft) {
  const encoder = new TextEncoder();
  const baseName = pptDraftOutputBaseName(draft.outline);
  const outputDir = await getPptDraftOutputDirectory(baseName);
  const pptxFile = `${baseName}.pptx`;
  const runId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const markdown = createPptDraftMarkdown(draft.outline);
  const outlineJson = `${JSON.stringify(draft.outline, null, 2)}\n`;
  const publicResult = {
    tool: 'ppt.draft',
    dry_run: false,
    output_dir: outputDir,
    output_file: pptxFile,
    output_path: joinPath(outputDir, pptxFile),
    run_id: runId,
    generated_at: new Date().toISOString(),
    theme: draft.theme,
    outline: draft.outline,
    outputs: [],
    manifest_path: joinPath(outputDir, 'manifest.json')
  };
  if (isTauri) {
    const { invoke } = await tauriCorePromise;
    for (const [fileName, bytes, kind] of [
      [pptxFile, draft.bytes, 'pptx'],
      ['outline.json', encoder.encode(outlineJson), 'json'],
      ['outline.md', encoder.encode(markdown), 'markdown']
    ]) {
      const outputPath = await writeUniqueFile(invoke, outputDir, fileName, bytes);
      publicResult.outputs.push({ path: outputPath, relative_path: fileName, kind, bytes: bytes.byteLength });
      if (kind === 'pptx') publicResult.output_path = outputPath;
    }
    const manifest = {
      ...createPptDraftManifest({
        outline: draft.outline,
        theme: draft.theme,
        outputFile: pptxFile,
        outputBytes: draft.bytes.byteLength,
        outputs: publicResult.outputs,
        assets: draft.assets,
        assetManifest: draft.asset_manifest
      }),
      tool: publicResult.tool,
      dry_run: false,
      output_dir: outputDir,
      run_id: runId,
      generated_at: publicResult.generated_at,
      provider: { model: 'desktop-configured-provider' }
    };
    const manifestPath = await writeUniqueFile(invoke, outputDir, 'manifest.json', encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`));
    publicResult.manifest_path = manifestPath;
    pptDraftLastOutputPath = outputDir;
    return publicResult;
  }
  const JSZipModule = await import('jszip');
  const JSZip = JSZipModule.default || JSZipModule;
  const zip = new JSZip();
  zip.file(pptxFile, draft.bytes);
  zip.file('outline.json', outlineJson);
  zip.file('outline.md', markdown);
  publicResult.outputs = [
    { path: `${outputDir}/${pptxFile}`, relative_path: pptxFile, kind: 'pptx', bytes: draft.bytes.byteLength },
    { path: `${outputDir}/outline.json`, relative_path: 'outline.json', kind: 'json', bytes: encoder.encode(outlineJson).byteLength },
    { path: `${outputDir}/outline.md`, relative_path: 'outline.md', kind: 'markdown', bytes: encoder.encode(markdown).byteLength }
  ];
  zip.file('manifest.json', JSON.stringify({
    ...createPptDraftManifest({
      outline: draft.outline,
      theme: draft.theme,
      outputFile: pptxFile,
      outputBytes: draft.bytes.byteLength,
      outputs: publicResult.outputs,
      assets: draft.assets,
      assetManifest: draft.asset_manifest
    }),
    tool: publicResult.tool,
    dry_run: false,
    output_dir: outputDir,
    run_id: runId,
    generated_at: publicResult.generated_at
  }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${baseName}_ppt_draft.zip`;
  anchor.click();
  retainBrowserObjectUrl(sessionScope, url);
  pptDraftLastOutputPath = outputDir;
  return publicResult;
}

function showPptDraftSuccess(outputPath, result) {
  if (pptDraftSuccessMeta) pptDraftSuccessMeta.textContent = pptDraftText('successMeta');
  if (pptDraftSuccessSlides) pptDraftSuccessSlides.textContent = `${result?.outline?.slides?.length || 0}`;
  if (pptDraftSuccessFile) pptDraftSuccessFile.textContent = result?.output_file || '';
  if (pptDraftSuccessPath) pptDraftSuccessPath.textContent = displayFilesystemPath(outputPath);
  setInteractiveLayer(pptDraftSuccessOverlay, true);
}

function importOutlineIntoPptDraft(outline, sourceLabel = '') {
  if (!outline) return false;
  try {
    const seed = pptDraftOutlineRequestSeed(outline, {
      prompt: pptDraftPrompt?.value || '',
      theme: pptDraftTheme?.value || 'minimal-mono',
      locale: pptDraftLocale?.value || (getLang() === 'en' ? 'en' : 'zh-CN'),
      deck_type: pptDraftDeckType?.value || 'auto',
      audience: pptDraftAudience?.value || '',
      purpose: pptDraftPurpose?.value || '',
      tone: pptDraftTone?.value || '',
      style: pptDraftStyle?.value || ''
    });
    const normalized = applyPptDraftOutlineDefaults(normalizePptDraftOutline(outline, {
      ...seed
    }));
    syncPptDraftImportedOutline(normalized, sourceLabel || normalized.title || '');
    return true;
  } catch (error) {
    console.error('Import outline into PPT draft failed:', error);
    showToast(String(error?.userMessage || error?.message || error));
    return false;
  }
}

async function generatePptDraftFromUi() {
  if (disposed || !pptDraftOverlay?.classList.contains('visible') || pptDraftBusy) return;
  const request = collectPptDraftRequest();
  if (!request) return;
  const operationRevision = sessionRevision;
  const operationController = new AbortController();
  pptDraftBusy = true;
  if (pptDraftGenerateBtn) pptDraftGenerateBtn.disabled = true;
  if (pptDraftOutlineImportBtn) pptDraftOutlineImportBtn.disabled = true;
  if (pptDraftOutlineClearBtn) pptDraftOutlineClearBtn.disabled = true;
  setPptAiPresetDisabled(pptDraftPresetButtons, true);
  pptDraftController = operationController;
  setPptDraftProgress(10, pptDraftImportedOutline ? pptDraftText('loadingOutline') : pptDraftText('validating'));
  try {
    let outline;
    if (pptDraftImportedOutline) {
      outline = normalizePptDraftOutline(pptDraftImportedOutline, {
        ...request,
        prompt: request.prompt || pptDraftImportedOutline.request?.prompt || pptDraftImportedOutline.title || ''
      });
      setPptDraftProgress(34, pptDraftText('building'));
    } else {
      if (!(await getAiApiKey())) {
        throw new Error(pptDraftText('needApiKey'));
      }
      if (!isCurrentOperation(operationRevision, operationController)) return;
      const messages = buildPptOutlineMessages({
        ...request,
        style: [request.style, `PPTX 草稿风格：${pptDraftThemeLabel(request.theme)}`].filter(Boolean).join('\n')
      });
      setPptDraftProgress(34, pptDraftText('generating'));
      const content = await callDeepSeek(messages, operationController.signal, 8192);
      if (!isCurrentOperation(operationRevision, operationController)) return;
      const parsed = extractPptOutlineJson(content);
      if (!parsed) throw new Error('AI provider did not return valid PPT outline JSON.');
      outline = normalizePptOutlineResult(parsed, request);
      setPptDraftProgress(62, pptDraftText('building'));
    }
    const effectiveTheme = outline.request?.theme || request.theme;
    const draftRequest = { ...request, theme: effectiveTheme };
    const draft = await buildPptDraftPptx(outline, { theme: effectiveTheme, request: draftRequest, assets: pptDraftAssets });
    if (!isCurrentOperation(operationRevision, operationController)) return;
    renderPptDraftResult(draft);
    setPptDraftProgress(82, pptDraftText('writing'));
    const exported = await exportPptDraftResult(draft);
    if (!isCurrentOperation(operationRevision, operationController)) return;
    setPptDraftProgress(100, pptDraftText('writing'));
    showToast(pptDraftText('generatedToast', { slides: draft.outline.slides.length }));
    showPptDraftSuccess(exported.output_dir, exported);
  } catch (error) {
    if (isCurrentOperation(operationRevision, operationController) && !operationController.signal.aborted) {
      console.error('PPT draft generation failed:', error);
      showToast(pptAiGenerationErrorMessage(error, pptDraftText));
    }
  } finally {
    if (pptDraftController === operationController) {
      pptDraftBusy = false;
      pptDraftController = null;
      if (!disposed && operationRevision === sessionRevision) {
        setPptDraftProgress(0, pptDraftText('processing'), false);
        if (pptDraftGenerateBtn) pptDraftGenerateBtn.disabled = false;
        if (pptDraftOutlineImportBtn) pptDraftOutlineImportBtn.disabled = false;
        if (pptDraftOutlineClearBtn) pptDraftOutlineClearBtn.disabled = !pptDraftImportedOutline;
        setPptAiPresetDisabled(pptDraftPresetButtons, false);
      }
    }
  }
}

bind(pptDraftBack, 'click', closePptDraftOverlay);
bind(pptDraftScrollArea, 'scroll', updatePptDraftScrollTop, { passive: true });
bind(pptDraftScrollTop, 'click', () => {
  pptDraftScrollArea?.scrollTo({ top: 0, behavior: 'smooth' });
});
pptDraftPresetButtons.forEach(button => {
  bind(button, 'click', () => applyPptDraftPreset(button.dataset.pptDraftPreset));
});
bind(pptDraftGenerateBtn, 'click', () => { void generatePptDraftFromUi(); });
bind(pptDraftOutlineImportBtn, 'click', () => { void choosePptDraftOutlineFile(); });
bind(pptDraftOutlineClearBtn, 'click', () => clearPptDraftImportedOutline());
bind(pptDraftOutlineFile, 'change', (event) => { void handlePptDraftOutlineFileInput(event); });
bind(pptDraftAssetPickBtn, 'click', () => { void choosePptDraftAssetFiles(); });
bind(pptDraftAssetFile, 'change', event => {
  void addPptDraftAssetFiles(event?.target?.files);
  if (pptDraftAssetFile) pptDraftAssetFile.value = '';
});
bind(pptDraftAssetList, 'click', event => {
  const button = event.target?.closest?.('[data-ppt-draft-asset-remove]');
  if (!button || !pptDraftAssetList.contains(button)) return;
  removePptDraftAsset(button.dataset.pptDraftAssetRemove || '');
});
bind(pptDraftSlideList, 'click', (event) => {
  const card = event.target?.closest?.('.ppt-draft-slide-card');
  if (!card || !pptDraftSlideList.contains(card)) return;
  openPptDraftEditor(card.dataset.pptDraftSlideIndex);
});
bind(pptDraftSlideList, 'keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target?.closest?.('.ppt-draft-slide-card');
  if (!card || !pptDraftSlideList.contains(card)) return;
  event.preventDefault();
  openPptDraftEditor(card.dataset.pptDraftSlideIndex);
});
bind(pptDraftEditorMoveUpBtn, 'click', () => movePptDraftEditorSlide(-1));
bind(pptDraftEditorMoveDownBtn, 'click', () => movePptDraftEditorSlide(1));
bind(pptDraftEditorRestoreBtn, 'click', () => restorePptDraftEditorOriginal());
bind(pptDraftEditorBack, 'click', () => closePptDraftEditor());
bind(pptDraftEditorStrip, 'click', (event) => {
  const item = event.target?.closest?.('[data-ppt-draft-editor-index]');
  if (!item || !pptDraftEditorStrip.contains(item)) return;
  selectPptDraftEditorSlide(item.dataset.pptDraftEditorIndex);
});
bind(pptDraftEditorStrip, 'dragstart', (event) => {
  const item = event.target?.closest?.('[data-ppt-draft-editor-index]');
  if (!item || !pptDraftEditorStrip.contains(item)) return;
  pptDraftEditorDragIndex = Number(item.dataset.pptDraftEditorIndex);
  if (pptDraftEditorDragIndex !== pptDraftEditorSelectedIndex) {
    pptDraftEditorDragIndex = -1;
    return;
  }
  clearPptDraftEditorDropTarget();
  item.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', String(pptDraftEditorDragIndex));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});
bind(pptDraftEditorStrip, 'dragend', (event) => {
  const item = event.target?.closest?.('[data-ppt-draft-editor-index]');
  if (item) item.classList.remove('dragging');
  pptDraftEditorDragIndex = -1;
  clearPptDraftEditorDropTarget();
});
bind(pptDraftEditorStrip, 'dragover', (event) => {
  const item = event.target?.closest?.('[data-ppt-draft-editor-index]');
  if (!item || !pptDraftEditorStrip.contains(item)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const targetIndex = Number(item.dataset.pptDraftEditorIndex);
  if (Number.isFinite(targetIndex) && targetIndex !== pptDraftEditorDropTargetIndex) {
    clearPptDraftEditorDropTarget();
    item.classList.add('drop-target');
    pptDraftEditorDropTargetIndex = targetIndex;
  }
});
bind(pptDraftEditorStrip, 'drop', (event) => {
  const item = event.target?.closest?.('[data-ppt-draft-editor-index]');
  if (!item || !pptDraftEditorStrip.contains(item)) return;
  event.preventDefault();
  const from = Number(event.dataTransfer?.getData('text/plain') || pptDraftEditorDragIndex);
  const to = Number(item.dataset.pptDraftEditorIndex);
  clearPptDraftEditorDropTarget();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
  movePptDraftEditorSlideToIndex(to);
});
[pptDraftEditorSlideTitle, pptDraftEditorClaim, pptDraftEditorBullets, pptDraftEditorVisual, pptDraftEditorNote]
  .forEach(input => bind(input, 'input', updatePptDraftEditorCurrentSlide));
bind(pptDraftEditorExportBtn, 'click', () => { void exportPptDraftEditorResult(); });
bind(document, 'keydown', (event) => {
  if (event.defaultPrevented) return;
  if (!pptDraftEditorOverlay?.classList.contains('visible')) return;
  const targetTag = String(event.target?.tagName || '').toLowerCase();
  const editingField = event.target?.isContentEditable || targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';
  if (!editingField) {
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      event.stopPropagation();
      selectPptDraftEditorSlide(pptDraftEditorSelectedIndex - 1);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      event.preventDefault();
      event.stopPropagation();
      selectPptDraftEditorSlide(pptDraftEditorSelectedIndex + 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      selectPptDraftEditorSlide(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      selectPptDraftEditorSlide(pptDraftEditorSlides().length - 1);
      return;
    }
  }
  if (event.key === 'Escape') {
    closePptDraftEditor();
  }
});
bind(pptDraftSuccessOk, 'click', () => {
  setInteractiveLayer(pptDraftSuccessOverlay, false);
});
bind(pptDraftSuccessOpenFolder, 'click', async () => {
  if (!isTauri || !pptDraftLastOutputPath) return;
  try {
    const { invoke } = await tauriCorePromise;
    await invoke('open_path', { path: pptDraftLastOutputPath });
  } catch (error) {
    console.error('Open PPT draft output folder failed:', error);
    showToast(pptDraftText('openFolderFailed'));
  }
});
  featureScope.use(subscribeLang(() => {
  if (!pptDraftOverlay?.classList.contains('visible')) return;
  if (!pptDraftLastResult) {
    if (pptDraftLocale) pptDraftLocale.value = getLang() === 'en' ? 'en' : 'zh-CN';
    refreshPptDraftSelects();
    return;
  }
  refreshPptDraftSelects();
  renderPptDraftResult(pptDraftLastResult);
  if (pptDraftEditorOverlay?.classList.contains('visible')) {
    renderPptDraftEditor();
  }
  }));

  return {
    open: openPptDraftOverlay,
    close: closePptDraftOverlay,
    importOutline: importOutlineIntoPptDraft,
    dispose() {
      if (disposed) return;
      disposed = true;
      sessionRevision += 1;
      sessionScope?.dispose();
      sessionScope = null;
      pptDraftController?.abort();
      pptDraftController = null;
      pptDraftBusy = false;
      closePptDraftEditor({ force: true, restore: false });
      if (pptDraftOverlay) {
        pptDraftOverlay.classList.remove('visible');
        pptDraftOverlay.setAttribute('aria-hidden', 'true');
      }
      pptDraftPlasmaInstance = disposeStandardToolPlasma(pptDraftPlasmaInstance);
      featureScope.dispose();
    },
    get busy() {
      return pptDraftBusy;
    }
  };
}
