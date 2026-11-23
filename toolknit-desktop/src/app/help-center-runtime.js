import { createLifecycleScope } from './tool-lifecycle.js';
import { moveFocusOutOfHiddenRegion } from '../shared/tool-page-shell.js';
import { createModalSession, setModalInteractivity } from './modal-runtime.js';

/** Owns help, feedback and legal overlays without coupling them to app startup. */
export function createHelpCenterRuntime({
  root = globalThis.document,
  windowRef = globalThis.window,
  translate: t = key => key,
  getLanguage = () => 'zh',
  onLangChange = () => () => {},
  getHelpContent = () => ({}),
  getLegalContent = () => ({}),
  escapeHtml = value => String(value ?? ''),
  settingsOverlay,
  settingsContent,
  pageTransition = null,
  syncCustomBackgroundPreviewPlayback = () => {},
  onShowSettings = () => {}
} = {}) {
  const scope = createLifecycleScope();
  const byId = id => root?.getElementById?.(id) || null;
  const on = (target, type, listener, options) => target?.addEventListener
    ? scope.event(target, type, listener, options)
    : () => {};

  const helpOverlay = byId('helpOverlay');
  const helpBackBtn = byId('helpBackBtn');
  const helpNav = byId('helpNav');
  const helpContentBody = byId('helpContentBody');
  const helpContentTitle = byId('helpContentTitle');
  const helpSearchInput = byId('helpSearchInput');
  const helpLinks = [byId('helpBtn'), byId('helpLink')].filter(Boolean);
  const feedbackLink = byId('feedbackLink');
  const declarationLink = byId('declarationLink');
  const usagePolicyLink = byId('usagePolicyLink');
  const feedbackOverlay = byId('feedbackOverlay');
  const feedbackBack = byId('feedbackBack');
  const feedbackSettings = byId('feedbackV2Settings');
  const feedbackBtn = byId('feedbackBtn');
  const legalOverlay = byId('legalOverlay');
  const legalBackBtn = byId('legalBackBtn');
  const legalNav = byId('legalNav');
  const legalContentTitle = byId('legalContentTitle');
  const legalTopTag = byId('legalTopTag');
  const legalContentBody = byId('legalContentBody');
  const marqueeTrack = byId('marqueeTrack');

  let helpSearchCache = null;
  let subpageReturnTarget = null;
  let background = null;
  let session = null;
  let activePage = null;
  let previousZIndex = '';

  const runTransition = action => {
    const currentAction = () => { if (!scope.disposed) return action(); };
    return pageTransition?.run ? pageTransition.run(currentAction) : Promise.resolve().then(currentAction);
  };

  function closeSettingsForSubpage() {
    if (!settingsOverlay?.classList.contains('visible')) return;
    moveFocusOutOfHiddenRegion(settingsOverlay);
    settingsOverlay.classList.remove('visible');
    setModalInteractivity(settingsOverlay, false);
    settingsOverlay.style.zIndex = '';
    syncCustomBackgroundPreviewPlayback();
  }

  function releasePage(restore = true) {
    session?.close({ restore });
    session = null;
    if (activePage) activePage.style.zIndex = previousZIndex;
    activePage = null;
    hideHelpOverlay(); hideFeedbackOverlay(); hideLegalOverlay();
  }

  function beginSubpageNavigation(page, source, onClose) {
    if (!activePage) {
      subpageReturnTarget = settingsOverlay?.classList.contains('visible') ? 'settings' : null;
      background = subpageReturnTarget ? settingsOverlay : source || root.activeElement?.closest?.('[id$="Overlay"], [id$="Workspace"], [id$="Dialog"]') || root.querySelector?.('.app');
      closeSettingsForSubpage();
    } else releasePage(false);
    activePage = page;
    previousZIndex = page.style.zIndex;
    const backgroundZ = Number.parseInt(background ? windowRef?.getComputedStyle?.(background)?.zIndex : '0', 10) || 0;
    const pageZ = Number.parseInt(windowRef?.getComputedStyle?.(page)?.zIndex, 10) || 0;
    page.style.zIndex = String(Math.max(pageZ, backgroundZ + 1));
    // Injected test roots share the same session contract as real DOM roots.
    session = createModalSession({ root: page, background, initialFocus: page.querySelector?.('button'), onClose, documentRef: root });
    session.open();
  }

  function hideHelpOverlay() {
    moveFocusOutOfHiddenRegion(helpOverlay);
    helpOverlay?.classList.remove('visible');
    if (helpSearchInput) helpSearchInput.value = '';
    helpNav?.querySelectorAll('.help-nav-item').forEach(item => { item.style.display = ''; });
    helpNav?.querySelectorAll('.help-nav-group').forEach(group => { group.style.display = ''; });
  }

  function hideFeedbackOverlay() {
    moveFocusOutOfHiddenRegion(feedbackOverlay);
    feedbackOverlay?.classList.remove('visible');

  }

  function hideLegalOverlay() {
    moveFocusOutOfHiddenRegion(legalOverlay);
    legalOverlay?.classList.remove('visible');
  }

  function restoreSettingsIfNeeded() {
    const restore = subpageReturnTarget === 'settings';
    subpageReturnTarget = null;
    background = null;
    if (restore) onShowSettings();
  }

  function closeHelpOverlay() {
    return runTransition(() => {
      releasePage();
      restoreSettingsIfNeeded();
    });
  }

  function buildHelpSearchCache() {
    const content = getHelpContent();
    if (helpSearchCache || !content) return;
    helpSearchCache = {};
    for (const key in content) {
      const entry = content[key];
      helpSearchCache[key] = `${entry.title} ${entry.html}`.toLowerCase();
    }
  }

  function showHelpSection(sectionId) {
    const content = getHelpContent();
    if (!content || !content[sectionId]) return;
    const data = content[sectionId];
    if (helpContentTitle) helpContentTitle.textContent = data.title;
    if (helpContentBody) {
      helpContentBody.innerHTML = data.html;
      helpContentBody.scrollTop = 0;
    }
    if (helpSearchInput) helpSearchInput.value = '';
    helpNav?.querySelectorAll('.help-nav-item').forEach(item => {
      item.style.display = '';
      item.classList.toggle('active', item.dataset.helpSection === sectionId);
    });
    helpNav?.querySelectorAll('.help-nav-group').forEach(group => { group.style.display = ''; });
  }

  function openHelpOverlay(sectionId = 'overview', source = null) {
    return runTransition(() => {
      if (!helpOverlay) return;
      beginSubpageNavigation(helpOverlay, source, closeHelpOverlay);
      showHelpSection(sectionId || 'overview');
    });
  }


  function openFeedbackOverlay(source = null) {
    return runTransition(() => {
      if (!feedbackOverlay) return;
      beginSubpageNavigation(feedbackOverlay, source, closeFeedbackOverlay);
    });
  }

  function closeFeedbackOverlay() {
    return runTransition(() => {
      releasePage();
      restoreSettingsIfNeeded();
    });
  }

  function getReviewers() {
    return [
      ['Sarah', 'home.feedbackPage.review1'], ['Michael', 'home.feedbackPage.review2'],
      ['Emily', 'home.feedbackPage.review3'], ['David', 'home.feedbackPage.review4'],
      ['Jessica', 'home.feedbackPage.review5'], ['James', 'home.feedbackPage.review6'],
      ['Olivia', 'home.feedbackPage.review7'], ['Christopher', 'home.feedbackPage.review8'],
      ['Amanda', 'home.feedbackPage.review9'], ['Matthew', 'home.feedbackPage.review10'],
      ['Elizabeth', 'home.feedbackPage.review11'], ['Daniel', 'home.feedbackPage.review12']
    ].map(([name, key]) => ({ name, text: t(key) }));
  }

  function renderReviews() {
    if (!marqueeTrack) return;
    const stars = Array.from({ length: 5 }, () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>').join('');
    const palettes = [
      ['#667eea', '#764ba2'], ['#f093fb', '#f5576c'], ['#4facfe', '#00f2fe'],
      ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#30cfd0', '#330867'],
      ['#a8edea', '#fed6e3'], ['#ff9a9e', '#fecfef'], ['#ffecd2', '#fcb69f'],
      ['#a18cd1', '#fbc2eb'], ['#fbc2eb', '#a6c1ee'], ['#84fab0', '#8fd3f4']
    ];
    const cards = getReviewers().map((reviewer, index) => {
      const initial = reviewer.name.charAt(0).toUpperCase();
      const [c1, c2] = palettes[index % palettes.length];
      const avatar = `<div class="marquee-avatar" style="background:var(--feedback-avatar-bg,linear-gradient(135deg,${c1},${c2}));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml(initial)}</div>`;
      return `<div class="marquee-card"><div class="marquee-card-header">${avatar}<div class="marquee-info"><div class="marquee-name">${escapeHtml(reviewer.name)}</div><div class="marquee-stars">${stars}</div></div></div><p class="marquee-text">${escapeHtml(reviewer.text)}</p></div>`;
    }).join('');
    marqueeTrack.innerHTML = cards + cards;
  }

  function showLegalSection(sectionId) {
    const content = getLegalContent();
    if (!content || !content[sectionId]) return;
    const data = content[sectionId];
    if (legalContentTitle) legalContentTitle.textContent = data.title;
    if (legalTopTag) legalTopTag.textContent = sectionId === 'usage-policy'
      ? 'ToolKnit Usage Policy' : 'ToolKnit Program Declaration';
    if (legalContentBody) {
      legalContentBody.innerHTML = data.html;
      legalContentBody.scrollTop = 0;
    }
    legalNav?.querySelectorAll('.help-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.legalSection === sectionId);
    });
  }

  function openLegalOverlay(sectionId = 'declaration') {
    return runTransition(() => {
      if (!legalOverlay) return;
      beginSubpageNavigation(legalOverlay, null, closeLegalOverlay);
      showLegalSection(sectionId);
    });
  }

  function closeLegalOverlay() {
    return runTransition(() => {
      releasePage();
      restoreSettingsIfNeeded();
    });
  }

  function navigateToSettings(overlay) {
    const ownedOverlay = overlay?.id === 'helpOverlay'
      || overlay?.id === 'feedbackOverlay'
      || overlay?.id === 'legalOverlay';
    if (!ownedOverlay) return false;
    return runTransition(() => {
      releasePage(false);
      subpageReturnTarget = null;
      background = null;
      onShowSettings();
    });
  }

  helpLinks.forEach(button => on(button, 'click', event => {
    event.preventDefault();
    openHelpOverlay(button.id === 'helpBtn' ? 'overview' : undefined);
  }));
  on(helpBackBtn, 'click', closeHelpOverlay);
  on(helpNav, 'click', event => {
    const item = event.target.closest('.help-nav-item');
    if (item?.dataset.helpSection) showHelpSection(item.dataset.helpSection);
  });
  on(helpContentBody, 'click', async event => {
    const button = event.target.closest('.help-prompt-copy');
    const prompt = button?.dataset.copyPrompt || '';
    if (!button || !prompt) return;
    const originalLabel = button.textContent;
    try {
      await windowRef?.navigator?.clipboard?.writeText?.(prompt);
      button.textContent = getLanguage() === 'zh' ? '已复制' : 'Copied';
      button.classList.add('is-copied');
      windowRef?.setTimeout?.(() => { button.textContent = originalLabel; button.classList.remove('is-copied'); }, 1600);
    } catch (error) {
      console.error('Could not copy Agent prompt:', error);
    }
  });
  on(helpSearchInput, 'input', () => {
    const query = helpSearchInput.value.trim().toLowerCase();
    if (!helpNav) return;
    if (!query) {
      helpNav.querySelectorAll('.help-nav-item').forEach(item => { item.style.display = ''; });
      helpNav.querySelectorAll('.help-nav-group').forEach(group => { group.style.display = ''; });
      const activeItem = helpNav.querySelector('.help-nav-item.active');
      if (activeItem?.dataset.helpSection) showHelpSection(activeItem.dataset.helpSection);
      return;
    }
    buildHelpSearchCache();
    let anyVisible = false;
    helpNav.querySelectorAll('.help-nav-group').forEach(group => {
      let groupHasVisible = false;
      group.querySelectorAll('.help-nav-item').forEach(item => {
        const section = item.dataset.helpSection || '';
        const cached = helpSearchCache?.[section] || '';
        const match = item.textContent.toLowerCase().includes(query) || cached.includes(query);
        item.style.display = match ? '' : 'none';
        if (match) groupHasVisible = true;
      });
      group.style.display = groupHasVisible ? '' : 'none';
      if (groupHasVisible) anyVisible = true;
    });
    if (helpContentBody && !anyVisible) helpContentBody.innerHTML = `<div class="help-search-empty">${escapeHtml(t('help.searchEmpty'))}</div>`;
  });
  on(root, 'click', event => {
    const button = event.target.closest?.('.home-v2-topbar [data-tool-help], .home-v2-topbar [data-tool-feedback]');
    if (!button) return;
    if (button.hasAttribute('data-tool-help')) void openHelpOverlay('overview', root.querySelector('.app'));
    else void openFeedbackOverlay(root.querySelector('.app'));
  });

  on(feedbackLink, 'click', event => { event.preventDefault(); openFeedbackOverlay(); });
  on(feedbackBtn, 'click', () => openFeedbackOverlay());
  on(feedbackBack, 'click', closeFeedbackOverlay);
  on(feedbackSettings, 'click', () => { void navigateToSettings(feedbackOverlay); });

  on(legalBackBtn, 'click', closeLegalOverlay);
  legalNav?.querySelectorAll('.help-nav-item').forEach(item => on(item, 'click', () => {
    if (item.dataset.legalSection) showLegalSection(item.dataset.legalSection);
  }));
  on(declarationLink, 'click', event => { event.preventDefault(); openLegalOverlay('declaration'); });
  on(usagePolicyLink, 'click', event => { event.preventDefault(); openLegalOverlay('usage-policy'); });

  scope.use(onLangChange(() => {
    helpSearchCache = null;
    const activeHelp = helpNav?.querySelector('.help-nav-item.active');
    if (activeHelp?.dataset.helpSection) showHelpSection(activeHelp.dataset.helpSection);
    const activeLegal = legalNav?.querySelector('.help-nav-item.active');
    if (legalOverlay?.classList.contains('visible')) showLegalSection(activeLegal?.dataset.legalSection || 'declaration');
    renderReviews();
  }));
  renderReviews();

  return Object.freeze({
    closeFeedbackOverlay,
    closeHelpOverlay,
    closeLegalOverlay,
    dispose: () => {
      releasePage(false);

      scope.dispose();
    },
    openFeedbackOverlay,
    openHelpOverlay,
    openLegalOverlay,
    navigateToSettings,
    getBackground: () => background,
    showHelpSection,
    showLegalSection
  });
}
