import './update-preview.css';
import en from './locales/en.json' with { type: 'json' };
import { getLang, onLangChange } from './i18n.js';

const PREVIEW_VERSIONS = Object.freeze({
  current: '3.1.0',
  latest: '3.1.0'
});

const PREVIEW_LINKS = Object.freeze({
  website: 'https://toolknit.com',
  repository: 'https://github.com/ZihangDong/toolknit-desktop',
  changelog: 'https://toolknit.com/changelog.html',
  feedback: 'https://github.com/ZihangDong/toolknit-desktop/issues'
});

const COPY = Object.freeze({
  zh: {
    available: 'UPDATE AVAILABLE',
    titleLead: '新版本已经',
    titleAccent: '织好了',
    intro: 'ToolKnit 3.1 测试版，持续打磨本地文件工作流。',
    mission: '我们做工具，不是为了堆数量，而是希望那些原本需要上传、等待和反复切换的事情，都能在你的电脑里安静地完成。',
    currentLabel: '当前版本',
    latestLabel: '最新版本',
    updateNow: '现在去更新',
    updateLater: '我还不想更新',
    previewNotice: '这是更新页面预览。正式接入更新服务后，这里会开始安全下载。',
    releaseKicker: 'WHAT\'S NEW · 3.1',
    releaseTitle: '更新不该被错过，\n也不该打断你。',
    releaseDescription: '新版本的变化会在这里被认真讲清楚。你可以先看、再决定，更新始终由你掌控。',
    highlightsLabel: '本次更新预览',
    highlight1Title: '主动但克制的提醒',
    highlight1Body: '只在合适的时机出现，不用再反复前往设置里手动检查。',
    highlight2Title: '更清楚的版本内容',
    highlight2Body: '更新重点、版本跨度和详细日志集中呈现，重要变化一眼可见。',
    highlight3Title: '安全、可恢复的流程',
    highlight3Body: '下载、验证和安装状态彼此分离，失败不会影响当前可用版本。',
    slogan: '把麻烦留给工具，把时间还给自己。',
    website: '网页版',
    repository: '开源仓库',
    changelog: '更新日志',
    feedback: '建议反馈',
    noticeRegion: '版本更新提醒',
    versionRange: '版本跨度',
    contentRegion: '版本更新内容',
    windowControls: '窗口控制',
    relatedLinks: 'ToolKnit 相关链接'
  },
  en: {
    available: 'UPDATE AVAILABLE',
    titleLead: 'A new version is',
    titleAccent: 'ready to unfold',
    intro: 'ToolKnit 3.1 preview: continued improvements to local file workflows.',
    mission: 'We do not build tools just to raise the count. We build them so tasks that once meant uploading, waiting, and switching apps can finish quietly on your own computer.',
    currentLabel: 'Current',
    latestLabel: 'Latest',
    updateNow: 'Update now',
    updateLater: 'Not right now',
    previewNotice: 'This is a UI preview. Secure downloading will be connected to this action later.',
    releaseKicker: 'WHAT\'S NEW · 3.1',
    releaseTitle: 'Updates should be noticed,\nnot interrupt your day.',
    releaseDescription: 'Every meaningful change will be explained here. Read first, decide second, and stay in control of when you update.',
    highlightsLabel: 'Release preview',
    highlight1Title: 'Timely, restrained reminders',
    highlight1Body: 'The notice appears at an appropriate moment, with no need to keep checking Settings.',
    highlight2Title: 'A clearer release story',
    highlight2Body: 'Highlights, version context, and the full changelog stay together and easy to scan.',
    highlight3Title: 'A recoverable update flow',
    highlight3Body: 'Download, verification, and installation are separate so a failure never harms the working version.',
    slogan: 'Leave the busywork to the tools. Keep the time for yourself.',
    website: 'Web app',
    repository: 'Repository',
    changelog: 'Changelog',
    feedback: 'Feedback',
    noticeRegion: 'Update notice',
    versionRange: 'Version comparison',
    contentRegion: 'Release highlights',
    windowControls: 'Window controls',
    relatedLinks: 'ToolKnit links'
  }
});

const TOOL_NAME_FALLBACKS = Object.freeze({
  'json-tools': 'JSON Formatter',
  base64: 'Base64 Codec',
  'url-codec': 'URL Codec',
  uuid: 'UUID Generator',
  jwt: 'JWT Viewer',
  'video-frame': 'Video Frame Export',
  'video-gif': 'Video to GIF'
});

function readPath(source, path) {
  return String(path || '').split('.').reduce((value, key) => value?.[key], source);
}

function formatToolId(toolId) {
  return String(toolId || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.length <= 4 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function collectEnglishToolNames() {
  const seen = new Set();
  const names = [];
  document.querySelectorAll('.audio-list-item[data-tool]').forEach(item => {
    const toolId = item.dataset.tool;
    if (!toolId || seen.has(toolId)) return;
    seen.add(toolId);
    const translationKey = item.dataset.i18nAriaLabel;
    const translated = translationKey ? readPath(en, translationKey) : '';
    names.push(
      (typeof translated === 'string' && translated.trim())
      || TOOL_NAME_FALLBACKS[toolId]
      || formatToolId(toolId)
    );
  });
  return names.length ? names : ['Local PDF', 'Image Toolkit', 'Audio Lab', 'Video Studio', 'Developer Tools'];
}

function renderToolMarquee(track) {
  if (!track) return;
  const names = collectEnglishToolNames();
  const makeGroup = hidden => {
    const group = document.createElement('div');
    group.className = 'update-preview-marquee-group';
    if (hidden) group.setAttribute('aria-hidden', 'true');
    names.forEach(name => {
      const item = document.createElement('span');
      item.className = 'update-preview-marquee-item';
      item.textContent = name;
      group.appendChild(item);
    });
    return group;
  };
  track.replaceChildren(makeGroup(false), makeGroup(true));
  track.style.setProperty('--update-marquee-duration', `${Math.max(72, Math.round(names.length * 1.7))}s`);
}

function applyReleaseCopy(root, release) {
  if (!release?.version) return;
  const language = getLang() === 'en' ? 'en' : 'zh';
  const version = release.version;
  const notes = Array.isArray(release.notes) ? release.notes.filter(note => note?.title || note?.body).slice(0, 3) : [];
  const strings = language === 'zh'
    ? {
        leftIntro: `ToolKnit ${version} 已经准备好。先看看这次认真完成的变化，再决定何时更新。`,
        kicker: `WHAT'S NEW · ${version}`,
        title: `ToolKnit ${version}\n更新内容`,
        description: release.summary || release.name || `新版本 ${version} 已经发布。`,
        notesLabel: '本次更新内容'
      }
    : {
        leftIntro: `ToolKnit ${version} is ready. Take a look at what changed, then decide when to update.`,
        kicker: `WHAT'S NEW · ${version}`,
        title: `ToolKnit ${version}\nRelease notes`,
        description: release.summary || release.name || `Version ${version} is ready.`,
        notesLabel: 'What changed'
      };

  root.querySelector('[data-update-copy="intro"]')?.replaceChildren(strings.leftIntro);
  root.querySelector('[data-update-release="brand-version"]')?.replaceChildren(`V${version}`);
  root.querySelector('[data-update-release="edition"]')?.replaceChildren(`TOOLKNIT DESKTOP · V${version}`);
  root.querySelector('[data-update-release="kicker"]')?.replaceChildren(strings.kicker);
  root.querySelector('[data-update-release="title"]')?.replaceChildren(strings.title);
  root.querySelector('[data-update-release="description"]')?.replaceChildren(strings.description);
  root.querySelector('[data-update-copy="highlightsLabel"]')?.replaceChildren(strings.notesLabel);
  root.querySelectorAll('[data-update-release-highlight]').forEach((element, index) => {
    const note = notes[index];
    const title = element.querySelector('[data-update-release-title]');
    const body = element.querySelector('[data-update-release-body]');
    if (!note) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    title?.replaceChildren(note.title || note.body);
    body?.replaceChildren(note.body || (language === 'zh' ? '查看本次版本说明以了解详细变化。' : 'Open the release notes for the full details.'));
  });
}

function applyLocalizedCopy(root, release = null) {
  const language = getLang() === 'en' ? 'en' : 'zh';
  const copy = COPY[language];
  root.lang = language === 'zh' ? 'zh-CN' : 'en';
  root.querySelectorAll('[data-update-copy]').forEach(element => {
    const value = copy[element.dataset.updateCopy];
    if (typeof value === 'string') element.textContent = value;
  });
  root.querySelectorAll('[data-update-aria]').forEach(element => {
    const value = copy[element.dataset.updateAria];
    if (typeof value === 'string') element.setAttribute('aria-label', value);
  });
  root.querySelector('[data-update-version="current"]')?.replaceChildren(release?.currentVersion || PREVIEW_VERSIONS.current);
  root.querySelector('[data-update-version="latest"]')?.replaceChildren(release?.version || PREVIEW_VERSIONS.latest);
  applyReleaseCopy(root, release);
}

function focusableElements(root) {
  return Array.from(root.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(element => !element.hidden && element.getClientRects().length > 0);
}

export function initUpdatePreview({
  openExternalUrl,
  notify,
  refreshBackgroundRendering,
  refreshIcons,
  onUpdate,
  onDefer,
  autoOpen = false
} = {}) {
  const overlay = document.getElementById('updatePreviewOverlay');
  if (!overlay || overlay.dataset.initialized === 'true') return null;
  overlay.dataset.initialized = 'true';

  const backgroundHost = overlay.querySelector('[data-update-background]');
  const updateButton = overlay.querySelector('[data-update-now]');
  const laterButton = overlay.querySelector('[data-update-later]');
  const laterLabel = laterButton?.querySelector('.update-preview-later-label');
  const marqueeTrack = overlay.querySelector('[data-update-marquee]');
  let backgroundDispose = null;
  let returnFocus = null;
  let inertRestore = null;
  let laterButtonRect = null;
  let laterLabelCenter = null;
  let laterPointerFrame = 0;
  let latestLaterPointer = null;
  let activeRelease = null;
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const shouldAnimateLaterLabel = () => !reducedMotionQuery?.matches;

  const isolateUnderlyingPage = () => {
    inertRestore = new Map();
    Array.from(document.body.children).forEach(element => {
      if (element === overlay || element.id === 'toastContainer') return;
      inertRestore.set(element, element.hasAttribute('inert'));
      element.setAttribute('inert', '');
    });
  };

  const restoreUnderlyingPage = () => {
    inertRestore?.forEach((wasInert, element) => {
      if (!element.isConnected || wasInert) return;
      element.removeAttribute('inert');
    });
    inertRestore = null;
  };

  const teardownBackground = () => {
    if (typeof backgroundDispose === 'function') {
      window.toolknitToolBackground?.dispose?.(backgroundDispose);
      backgroundDispose = null;
    }
    backgroundHost?.classList.remove('has-user-background');
  };

  const mountBackground = () => {
    teardownBackground();
    if (!backgroundHost) return;
    const config = window.toolknitCustomBackground?.getConfig?.();
    const hasCustomBackground = Boolean(config?.type && (config.path || config.src));
    backgroundHost.classList.toggle('has-user-background', hasCustomBackground);
    if (!hasCustomBackground) return;
    try {
      backgroundDispose = window.toolknitToolBackground?.mount?.(backgroundHost) || null;
    } catch (error) {
      console.warn('Update preview background could not be mounted:', error);
      backgroundDispose = null;
      backgroundHost.classList.remove('has-user-background');
    }
  };

  const setRelease = release => {
    activeRelease = release?.version ? { ...release } : null;
    applyLocalizedCopy(overlay, activeRelease);
    refreshIcons?.();
  };

  const open = release => {
    if (overlay.classList.contains('visible')) return;
    if (release) setRelease(release);
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add('update-preview-open');
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    isolateUnderlyingPage();
    mountBackground();
    refreshBackgroundRendering?.();
    window.requestAnimationFrame(() => updateButton?.focus({ preventScroll: true }));
  };

  const close = () => {
    if (!overlay.classList.contains('visible')) return;
    teardownBackground();
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('update-preview-open');
    restoreUnderlyingPage();
    refreshBackgroundRendering?.();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  };

  const handleKeydown = event => {
    if (!overlay.classList.contains('visible')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(overlay);
    if (!focusable.length) {
      event.preventDefault();
      overlay.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!overlay.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  updateButton?.addEventListener('click', () => {
    if (activeRelease && typeof onUpdate === 'function') {
      void onUpdate(activeRelease);
      return;
    }
    const language = getLang() === 'en' ? 'en' : 'zh';
    notify?.(COPY[language].previewNotice);
  });
  laterButton?.addEventListener('click', () => {
    if (activeRelease && typeof onDefer === 'function') onDefer(activeRelease);
    close();
  });

  const resetLaterLabel = () => {
    if (laterPointerFrame) {
      window.cancelAnimationFrame(laterPointerFrame);
      laterPointerFrame = 0;
    }
    latestLaterPointer = null;
    laterLabel?.style.setProperty('--update-later-shift-x', '0px');
    laterLabel?.style.setProperty('--update-later-shift-y', '0px');
  };

  const captureLaterLabelGeometry = () => {
    if (!laterButton || !laterLabel) return;
    laterButtonRect = laterButton.getBoundingClientRect();
    const labelRect = laterLabel.getBoundingClientRect();
    laterLabelCenter = {
      x: labelRect.left + labelRect.width / 2,
      y: labelRect.top + labelRect.height / 2
    };
  };

  const moveLaterLabelAway = () => {
    laterPointerFrame = 0;
    if (!latestLaterPointer || !laterLabel || !laterLabelCenter || !laterButtonRect) return;
    const deltaX = latestLaterPointer.x - laterLabelCenter.x;
    const deltaY = latestLaterPointer.y - laterLabelCenter.y;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const influence = Math.max(0, 1 - distance / 118);
    const strength = 13 * influence;
    const shiftX = Math.max(-10, Math.min(10, -(deltaX / distance) * strength));
    const shiftY = Math.max(-4, Math.min(4, -(deltaY / distance) * strength));
    laterLabel.style.setProperty('--update-later-shift-x', `${shiftX.toFixed(2)}px`);
    laterLabel.style.setProperty('--update-later-shift-y', `${shiftY.toFixed(2)}px`);
  };

  laterButton?.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch' || !shouldAnimateLaterLabel()) return;
    captureLaterLabelGeometry();
  });
  laterButton?.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !laterButtonRect || !shouldAnimateLaterLabel()) return;
    latestLaterPointer = { x: event.clientX, y: event.clientY };
    if (!laterPointerFrame) laterPointerFrame = window.requestAnimationFrame(moveLaterLabelAway);
  });
  laterButton?.addEventListener('pointerleave', resetLaterLabel);
  laterButton?.addEventListener('blur', resetLaterLabel);
  reducedMotionQuery?.addEventListener?.('change', resetLaterLabel);
  overlay.querySelectorAll('[data-update-link]').forEach(link => {
    link.addEventListener('click', event => {
      const url = PREVIEW_LINKS[link.dataset.updateLink];
      if (!url || typeof openExternalUrl !== 'function') return;
      event.preventDefault();
      void openExternalUrl(url);
    });
  });
  document.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('pagehide', teardownBackground);
  window.addEventListener('pageshow', () => {
    if (overlay.classList.contains('visible')) mountBackground();
  });

  renderToolMarquee(marqueeTrack);
  applyLocalizedCopy(overlay);
  onLangChange(() => applyLocalizedCopy(overlay, activeRelease));
  refreshIcons?.();

  window.openToolKnitUpdatePreview = open;
  window.closeToolKnitUpdatePreview = close;

  const previewRequested = autoOpen || (
    import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('update-preview') === '1'
  );
  if (previewRequested) window.requestAnimationFrame(open);

  return { open, close, setRelease };
}
