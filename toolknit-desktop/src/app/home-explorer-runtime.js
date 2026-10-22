import { createLifecycleScope } from './tool-lifecycle.js';
import { createSettingsController } from './settings-controller.js';

const FAVORITES_KEY = 'toolknit_favorites';
const MAX_FAVORITES = 6;
const PAGE_SIZE = 12;
// V3.1/V3.2 discoveries include the expanded clipboard workflow without changing tool categories.
const NEW_FEATURE_TOOLS = new Set(['quick-screenshot', 'pdf-to-scan', 'duplicate-file-cleanup', 'pdf-to-word', 'clipboard-history', 'image-to-pdf']);

const categoryGroup = category => ({ audio: 'media', video: 'media', calculator: 'calc', cleanup: 'clean' }[category] || category || '');
const CATEGORY_LABEL_KEYS = Object.freeze({
  pdf: 'home.toolNames.pdfCategoryTag',
  ppt: 'home.toolNames.pptCategoryTag',
  spreadsheet: 'home.toolNames.spreadsheetCategoryTag',
  image: 'home.toolNames.imageCategoryTag',
  audio: 'home.toolNames.audioCategoryTag',
  video: 'home.toolNames.videoCategoryTag',
  text: 'home.toolNames.textCategoryTag',
  calculator: 'home.toolNames.calcCategoryTag',
  creative: 'home.toolNames.creativeCategoryTag',
  ai: 'home.toolNames.aiCategoryTag',
  hardware: 'home.toolNames.hardwareCategoryTag',
  developer: 'home.toolNames.developerCategoryTag',
  cleanup: 'home.toolNames.cleanupCategoryTag'
});
const categoryLabel = (category, translate) => {
  const key = CATEGORY_LABEL_KEYS[category];
  return key ? translate(key) : String(category || '').toUpperCase();
};

/** Owns searchable home-tool projection, card interactions, and favorites. */
export function createHomeExplorerRuntime({
  root = globalThis.document,
  storage = globalThis.localStorage,
  translate = key => key,
  escapeHtml = value => String(value),
  createIcons = () => {},
  onLaunchTool = () => {},
  onOpenSupport = () => {},
  onError = error => console.warn('Home explorer runtime:', error)
} = {}) {
  const scope = createLifecycleScope({ onError });
  const bindEvent = (target, type, listener, options) => target?.addEventListener
    ? scope.event(target, type, listener, options)
    : () => {};
  const homeScrollContainer = root?.querySelector?.('.main-content');
  const homeToolSearch = root?.getElementById?.('homeToolSearch');
  const homeToolGrid = root?.getElementById?.('homeToolGrid');
  const homeToolLoadMore = root?.getElementById?.('homeToolLoadMore');
  const homeToolLoadMoreSummary = root?.getElementById?.('homeToolLoadMoreSummary');
  const homeToolLoadMoreButton = root?.getElementById?.('homeToolLoadMoreButton');
  const backToTop = root?.getElementById?.('backToTop');
  const categoryChips = Array.from(root?.querySelectorAll?.('[data-home-category]') || []);
  const manageFavoritesButton = root?.getElementById?.('manageFavorites');
  const homeLazyLoadToggle = root?.getElementById?.('homeLazyLoadToggle');
  const homeLazyLoadStatus = root?.getElementById?.('homeLazyLoadStatus');
  const settings = createSettingsController({ storage, prefix: 'toolknit_' });
  let lazyLoadEnabled = settings.read('home_lazy_load', 'true') !== 'false';
  let activeCategory = 'all';
  let visibleToolCount = PAGE_SIZE;
  let favoritesManageMode = false;
  let toastTimer = null;
  let scrollRaf = 0;
  const waterState = new WeakMap();

  const readFavorites = () => {
    try {
      const value = JSON.parse(storage?.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(value) ? value.slice(0, MAX_FAVORITES) : [];
    } catch { return []; }
  };
  const writeFavorites = favorites => {
    try { storage?.setItem(FAVORITES_KEY, JSON.stringify(favorites.slice(0, MAX_FAVORITES))); }
    catch (error) { onError(error); }
  };
  const getToolInfo = item => {
    const section = item?.closest?.('.content-section');
    return {
      toolId: item?.dataset.tool || '',
      name: item?.querySelector?.('.audio-list-title')?.textContent?.trim() || item?.dataset.tool || 'Tool',
      desc: item?.querySelector?.('.audio-list-desc')?.textContent?.trim() || '',
      iconHtml: item?.querySelector?.('.audio-list-icon')?.innerHTML || '',
      category: section?.dataset.category || ''
    };
  };
  const findToolInfo = toolId => {
    // Match the data value in JavaScript so this path remains compatible with
    // older WebView2 builds that do not expose CSS.escape(). It also avoids
    // interpolating user-controlled ids into a CSS selector.
    const item = Array.from(root?.querySelectorAll?.('.content-section:not([data-category="home"]) .audio-list-item') || [])
      .find(candidate => candidate.dataset?.tool === toolId);
    return item ? getToolInfo(item) : { toolId };
  };
  const showFavoriteToast = message => {
    const toast = root?.getElementById?.('favToast');
    const text = root?.getElementById?.('favToastText');
    if (!toast || !text) return;
    text.textContent = message;
    toast.classList.add('visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3600);
  };
  const isFavorited = toolId => readFavorites().some(item => item.tool === toolId);
  const saveFavorite = info => {
    if (!info?.toolId || isFavorited(info.toolId)) return false;
    const favorites = readFavorites();
    if (favorites.length >= MAX_FAVORITES) { showFavoriteToast(translate('home.favLimit')); return false; }
    favorites.push({ tool: info.toolId, name: info.name, desc: info.desc, iconHtml: info.iconHtml, category: info.category, ts: Date.now() });
    writeFavorites(favorites);
    renderFavorites();
    showFavoriteToast(translate('home.favAdded'));
    return true;
  };
  const removeFavorite = toolId => {
    writeFavorites(readFavorites().filter(item => item.tool !== toolId));
    renderFavorites();
    showFavoriteToast(translate('home.favRemoved'));
  };
  const syncFavoritesMode = () => {
    const container = root?.getElementById?.('favoritesContent');
    container?.classList.toggle('is-managing', favoritesManageMode);
    container?.querySelectorAll?.('[data-remove-favorite]').forEach(button => {
      button.tabIndex = favoritesManageMode ? 0 : -1;
      button.setAttribute('aria-hidden', String(!favoritesManageMode));
    });
    manageFavoritesButton?.classList.toggle('is-active', favoritesManageMode);
    manageFavoritesButton?.setAttribute('aria-pressed', String(favoritesManageMode));
  };
  function renderFavorites() {
    const container = root?.getElementById?.('favoritesContent');
    if (!container) return;
    const favorites = readFavorites();
    if (!favorites.length) {
      container.innerHTML = `<div class="fav-empty-guide"><div class="fav-empty-icon"><i data-lucide="mouse-pointer-click"></i></div><div class="fav-empty-text">${escapeHtml(translate('home.favEmptyGuide'))}</div></div>`;
      createIcons();
      syncFavoritesMode();
      return;
    }
    container.innerHTML = favorites.map(record => {
      const liveInfo = findToolInfo(record.tool);
      const info = {
        ...record,
        ...liveInfo,
        name: liveInfo.name || record.name || liveInfo.toolId,
        desc: liveInfo.desc || record.desc || '',
        iconHtml: liveInfo.iconHtml || record.iconHtml || '',
        category: liveInfo.category || record.category || '',
        toolId: record.tool
      };
      const removeLabel = translate('home.favRemove');
      return `<article class="favorite-item" role="button" tabindex="0" data-tool="${escapeHtml(info.toolId)}" data-category="${escapeHtml(info.category || '')}">
        <span class="card-water-layer" aria-hidden="true"><span class="card-water-ripple"></span></span>
        <span class="favorite-top"><span class="favorite-icon">${info.iconHtml || ''}</span><span class="favorite-category">${escapeHtml(categoryLabel(info.category, translate))}</span></span>
        <span class="favorite-copy"><span class="favorite-name">${escapeHtml(info.name)}</span><span class="favorite-desc">${escapeHtml(info.desc || '')}</span></span>
        <button class="favorite-remove-btn" type="button" data-remove-favorite="${escapeHtml(info.toolId)}" aria-label="${escapeHtml(removeLabel)}" title="${escapeHtml(removeLabel)}"><i data-lucide="x"></i></button>
      </article>`;
    }).join('');
    createIcons();
    syncFavoritesMode();
  }
  const seedFavorites = () => {
    try { if (storage?.getItem(FAVORITES_KEY) !== null) return; } catch { return; }
    const candidates = Array.from(root?.querySelectorAll?.('.content-section:not([data-category="home"]) .audio-list-item') || [])
      .filter(item => item.dataset.availability !== 'planned');
    const preferred = ['pdf-enhance', 'ppt-draft', 'video-gif', 'ai-doc', 'hardware-cpu-memory', 'pdf-merge'];
    const ordered = [...preferred.map(id => candidates.find(item => item.dataset.tool === id)).filter(Boolean), ...candidates.filter(item => !preferred.includes(item.dataset.tool))];
    writeFavorites(ordered.slice(0, MAX_FAVORITES).map(item => ({ ...getToolInfo(item), tool: item.dataset.tool, ts: Date.now() })));
  };
  const collectTools = () => Array.from(root?.querySelectorAll?.('.content-section:not([data-category="home"]) .audio-list-item') || [])
    .filter(item => item.dataset.availability !== 'planned')
    .map(item => {
      const info = getToolInfo(item);
      const tag = item.querySelector('.audio-tag')?.textContent?.trim() || categoryLabel(info.category, translate);
      return { ...info, tag, homeCategory: categoryGroup(info.category), searchable: `${info.name} ${info.desc} ${tag} ${info.category}`.toLowerCase() };
    });
  const renderHomeTools = ({ resetPagination = false } = {}) => {
    homeLazyLoadToggle?.setAttribute('aria-pressed', String(lazyLoadEnabled));
    if (homeLazyLoadStatus) homeLazyLoadStatus.textContent = translate(lazyLoadEnabled ? 'settings.homeLazyLoadOn' : 'settings.homeLazyLoadOff');
    if (!homeToolSearch || !homeToolGrid) return;
    if (resetPagination) visibleToolCount = PAGE_SIZE;
    const query = homeToolSearch.value.trim().toLowerCase();
    const tools = collectTools().filter(item => {
      const matchesCategory = activeCategory === 'new' ? NEW_FEATURE_TOOLS.has(item.toolId)
        : activeCategory === 'all' || item.homeCategory === activeCategory;
      return matchesCategory && (!query || item.searchable.includes(query));
    });
    const shown = lazyLoadEnabled ? tools.slice(0, visibleToolCount) : tools;
    homeToolGrid.innerHTML = shown.length ? shown.map(item => `<button class="tool-result-card" type="button" data-home-tool="${escapeHtml(item.toolId)}" data-tool-category="${escapeHtml(item.homeCategory)}"><span class="card-water-layer" aria-hidden="true"><span class="card-water-ripple"></span></span><span class="tool-result-top"><span class="tool-result-icon">${item.iconHtml || '<i data-lucide="sparkles"></i>'}</span><span class="tool-result-tag">${escapeHtml(item.tag)}</span></span><span><span class="tool-result-name">${escapeHtml(item.name)}</span><span class="tool-result-desc">${escapeHtml(item.desc)}</span></span></button>`).join('') : `<div class="tool-result-empty">${escapeHtml(translate('home.noToolsFound'))}</div>`;
    const remaining = Math.max(0, tools.length - shown.length);
    if (homeToolLoadMore) homeToolLoadMore.hidden = remaining === 0;
    if (homeToolLoadMoreSummary) homeToolLoadMoreSummary.textContent = remaining ? `${translate('home.loadMoreSummary', { shown: shown.length, total: tools.length })} · ${translate('home.loadMoreRemaining', { remaining })}` : translate('home.loadMoreSummary', { shown: shown.length, total: tools.length });
    if (homeToolLoadMoreButton) homeToolLoadMoreButton.disabled = remaining === 0;
    createIcons();
  };
  const updateWaterCard = (card, event) => {
    if (!card || (event.pointerType && event.pointerType !== 'mouse')) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const state = waterState.get(card) || { x: 50, y: 50, raf: 0 };
    state.x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    state.y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    waterState.set(card, state);
    if (state.raf) return;
    state.raf = window.requestAnimationFrame(() => { card.style.setProperty('--water-x', `${state.x}%`); card.style.setProperty('--water-y', `${state.y}%`); state.raf = 0; });
  };
  const cardFromEvent = event => event.target?.closest?.('.tool-result-card, .favorite-item');

  bindEvent(root, 'click', event => {
    const removeButton = event.target?.closest?.('[data-remove-favorite]');
    if (removeButton) { event.preventDefault(); event.stopPropagation(); removeFavorite(removeButton.dataset.removeFavorite); return; }
    const card = event.target?.closest?.('[data-home-tool], .favorite-item');
    if (card) onLaunchTool(card.dataset.homeTool || card.dataset.tool);
  });
  bindEvent(root, 'keydown', event => {
    if (event.target?.closest?.('[data-remove-favorite]')) return;
    const card = event.target?.closest?.('.favorite-item');
    if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onLaunchTool(card.dataset.tool); }
  });
  bindEvent(root, 'contextmenu', event => {
    const card = cardFromEvent(event);
    if (!card || card.dataset.availability === 'planned') return;
    if (card.matches('.audio-list-item')) { event.preventDefault(); saveFavorite(getToolInfo(card)); }
    else if (card.matches('.tool-result-card')) { event.preventDefault(); saveFavorite(findToolInfo(card.dataset.homeTool)); }
  });
  bindEvent(homeToolSearch, 'input', () => renderHomeTools({ resetPagination: true }));
  bindEvent(homeLazyLoadToggle, 'click', () => {
    lazyLoadEnabled = !lazyLoadEnabled;
    settings.write('home_lazy_load', lazyLoadEnabled);
    renderHomeTools({ resetPagination: true });
  });
  bindEvent(homeToolLoadMoreButton, 'click', () => { visibleToolCount += PAGE_SIZE; renderHomeTools(); });
  bindEvent(manageFavoritesButton, 'click', () => { favoritesManageMode = !favoritesManageMode; syncFavoritesMode(); if (!readFavorites().length) showFavoriteToast(translate('home.favEmptyGuide')); });
  categoryChips.forEach(chip => bindEvent(chip, 'click', () => { activeCategory = chip.dataset.homeCategory || 'all'; categoryChips.forEach(item => { const active = item === chip; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', String(active)); }); renderHomeTools({ resetPagination: true }); }));
  bindEvent(root, 'pointermove', event => updateWaterCard(cardFromEvent(event), event), { passive: true });
  bindEvent(root, 'pointerover', event => cardFromEvent(event)?.setAttribute('data-water-active', 'true'));
  bindEvent(root, 'pointerout', event => cardFromEvent(event)?.setAttribute('data-water-active', 'false'));
  bindEvent(root?.querySelector?.('[data-open-tools]'), 'click', () => { const explorer = root?.querySelector?.('.tool-explorer'); if (explorer && homeScrollContainer) homeScrollContainer.scrollTo({ top: Math.max(0, explorer.offsetTop - 44), behavior: 'smooth' }); });
  root?.querySelectorAll?.('[data-open-support]').forEach(button => bindEvent(button, 'click', onOpenSupport));
  bindEvent(homeScrollContainer, 'scroll', () => { if (scrollRaf) return; window.requestAnimationFrame(() => { scrollRaf = 0; backToTop?.classList.toggle('is-visible', homeScrollContainer.scrollTop > 320); }); }, { passive: true });
  bindEvent(backToTop, 'click', () => homeScrollContainer?.scrollTo({ top: 0, behavior: 'smooth' }));
  seedFavorites();
  renderHomeTools();
  renderFavorites();
  return Object.freeze({ dispose: scope.dispose, renderFavorites, renderHomeTools, showFavoriteToast });
}
