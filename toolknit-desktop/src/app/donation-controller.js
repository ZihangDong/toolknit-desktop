import { SUPPORT_JOURNAL_ENTRIES } from '../support-journal-data.js';
import { createLifecycleScope } from './tool-lifecycle.js';
import { createModalSession } from './modal-runtime.js';
import { saveDonationQr } from './donation-qr-runtime.js';
import { t } from '../i18n.js';

const JOURNAL_DURATION_MS = 15_000;

export function createDonationController({ openExternalUrl, isTauri = false, notify = () => {} } = {}) {
  const overlay = document.getElementById('donationOverlay');
  if (!overlay) return { open() {}, close() {}, dispose() {} };

  const dialog = overlay.querySelector('.donation-dialog');
  const scroll = overlay.querySelector('.donation-scroll');
  const reader = document.getElementById('donationJournalReader');
  const date = document.getElementById('donationJournalDate');
  const count = document.getElementById('donationJournalReaderCount');
  const title = document.getElementById('donationJournalReaderTitle');
  const body = document.getElementById('donationJournalReaderBody');
  const hint = document.getElementById('donationJournalReaderHint');
  const progress = document.getElementById('donationJournalProgressBar');
  const status = document.getElementById('donationJournalStatus');
  const lifecycle = createLifecycleScope();

  let order = [];
  let index = -1;
  let timer = null;
  let raf = null;
  let transitionTimer = null;
  let paused = false;
  let startedAt = 0;
  let elapsed = 0;
  let wasPlayingBeforeHidden = false;
  let modalSession = null;
  let previousZIndex = '';
  let currentBackground = null;
  let qrSave = null;

  const clearPlayback = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (transitionTimer !== null) window.clearTimeout(transitionTimer);
    if (raf !== null) window.cancelAnimationFrame(raf);
    timer = null;
    transitionTimer = null;
    raf = null;
    startedAt = 0;
    elapsed = 0;
    paused = false;
    wasPlayingBeforeHidden = false;
    progress?.style.setProperty('width', '0%');
    reader?.classList.remove('is-paused', 'is-entering', 'is-leaving');
    reader?.setAttribute('aria-pressed', 'false');
    if (hint) hint.textContent = '点击文字暂停 · 再次点击继续播放';
  };

  const shuffle = () => {
    const previous = index >= 0 ? order[index] : -1;
    order = Array.from({ length: SUPPORT_JOURNAL_ENTRIES.length }, (_, itemIndex) => itemIndex);
    for (let itemIndex = order.length - 1; itemIndex > 0; itemIndex -= 1) {
      const swapIndex = Math.floor(Math.random() * (itemIndex + 1));
      [order[itemIndex], order[swapIndex]] = [order[swapIndex], order[itemIndex]];
    }
    if (order.length > 1 && order[0] === previous) [order[0], order[1]] = [order[1], order[0]];
    index = -1;
  };

  const renderEntry = (entry, position) => {
    if (!entry || !reader) return;
    reader.classList.remove('is-entering');
    reader.classList.add('is-leaving');
    if (transitionTimer !== null) window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => {
      transitionTimer = null;
      if (date) date.textContent = entry.date || '';
      if (count) count.textContent = `${String(position + 1).padStart(2, '0')} / ${SUPPORT_JOURNAL_ENTRIES.length}`;
      if (title) title.textContent = entry.title || '';
      body?.replaceChildren();
      (Array.isArray(entry.paragraphs) ? entry.paragraphs : []).forEach(paragraphText => {
        const paragraph = document.createElement('p');
        paragraph.textContent = paragraphText;
        body?.append(paragraph);
      });
      reader.classList.remove('is-leaving');
      reader.classList.add('is-entering');
      window.requestAnimationFrame(() => reader.classList.remove('is-entering'));
    }, 180);
  };

  const scheduleNext = () => {
    if (!overlay.classList.contains('visible') || paused) return;
    if (!order.length || index >= order.length - 1) shuffle();
    index += 1;
    renderEntry(SUPPORT_JOURNAL_ENTRIES[order[index]], index);
    elapsed = 0;
    startedAt = performance.now();
    progress?.style.setProperty('width', '0%');
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      scheduleNext();
    }, JOURNAL_DURATION_MS);
  };

  const progressTick = now => {
    if (!startedAt || paused || !overlay.classList.contains('visible')) return;
    elapsed = Math.min(JOURNAL_DURATION_MS, now - startedAt);
    progress?.style.setProperty('width', `${(elapsed / JOURNAL_DURATION_MS) * 100}%`);
    raf = window.requestAnimationFrame(progressTick);
  };

  const pause = () => {
    if (paused) return;
    elapsed = startedAt ? Math.min(JOURNAL_DURATION_MS, performance.now() - startedAt) : 0;
    paused = true;
    reader?.classList.add('is-paused');
    reader?.setAttribute('aria-pressed', 'true');
    if (timer !== null) window.clearTimeout(timer);
    if (raf !== null) window.cancelAnimationFrame(raf);
    timer = null;
    raf = null;
    if (hint) hint.textContent = '已暂停 · 再次点击继续播放';
  };

  const resume = () => {
    if (!paused) return;
    paused = false;
    startedAt = performance.now() - elapsed;
    reader?.classList.remove('is-paused');
    reader?.setAttribute('aria-pressed', 'false');
    if (hint) hint.textContent = '点击文字暂停 · 再次点击继续播放';
    timer = window.setTimeout(() => {
      timer = null;
      scheduleNext();
    }, Math.max(0, JOURNAL_DURATION_MS - elapsed));
    raf = window.requestAnimationFrame(progressTick);
  };

  const toggle = () => (paused ? resume() : pause());
  const start = () => {
    if (!reader || !SUPPORT_JOURNAL_ENTRIES.length) return;
    clearPlayback();
    shuffle();
    if (status) status.textContent = `${SUPPORT_JOURNAL_ENTRIES.length} 篇开发者手记 · 随机循环播放`;
    scheduleNext();
    raf = window.requestAnimationFrame(progressTick);
  };

  const open = ({ background } = {}) => {
    if (lifecycle.disposed || overlay.classList.contains('visible')) return;
    const page = background || document.activeElement?.closest('[id$="Overlay"], [id$="Workspace"], [id$="Dialog"]') || document.querySelector('.app');
    currentBackground = page;
    previousZIndex = overlay.style.zIndex;
    const backgroundZ = Number.parseInt(page ? getComputedStyle(page).zIndex : '0', 10) || 0;
    const overlayZ = Number.parseInt(getComputedStyle(overlay).zIndex, 10) || 0;
    overlay.style.zIndex = String(Math.max(overlayZ, backgroundZ + 1));
    modalSession = createModalSession({ root: overlay, background: page, initialFocus: dialog, onClose: close });
    modalSession.open();
    document.body.classList.add('donation-open');
    if (scroll) scroll.scrollTop = 0;
    start();
  };

  const close = () => {
    if (!overlay.classList.contains('visible')) return;
    modalSession?.close();
    modalSession = null;
    currentBackground = null;
    qrSave?.abort();
    qrSave = null;
    overlay.querySelectorAll('[data-donation-save-qr]').forEach(button => { button.disabled = false; });
    overlay.style.zIndex = previousZIndex;
    document.body.classList.remove('donation-open');
    clearPlayback();
  };

  reader && lifecycle.event(reader, 'click', toggle);
  reader && lifecycle.event(reader, 'keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
  lifecycle.event(document, 'visibilitychange', () => {
    if (!overlay.classList.contains('visible')) return;
    if (document.hidden) {
      wasPlayingBeforeHidden = !paused;
      if (wasPlayingBeforeHidden) pause();
    } else if (wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      resume();
    }
  });
  overlay.querySelectorAll('[data-donation-close]').forEach(button => lifecycle.event(button, 'click', close));
  overlay.querySelectorAll('[data-donation-save-qr]').forEach(button => lifecycle.event(button, 'click', async () => {
    if (qrSave || !overlay.classList.contains('visible')) return;
    const owner = new AbortController();
    qrSave = owner;
    overlay.querySelectorAll('[data-donation-save-qr]').forEach(item => { item.disabled = true; });
    try {
      const saved = await saveDonationQr(button.dataset.donationSaveQr, { isTauri, signal: owner.signal });
      if (saved && !owner.signal.aborted) notify(t('home.supportPage.qrSaved'));
    } catch {
      if (!owner.signal.aborted) notify(t('home.supportPage.qrSaveFailed'));
    } finally {
      if (qrSave === owner) {
        qrSave = null;
        overlay.querySelectorAll('[data-donation-save-qr]').forEach(item => { item.disabled = false; });
      }
    }
  }));
  overlay.querySelectorAll('[data-donation-link]').forEach(button => lifecycle.event(button, 'click', () => {
    const urls = { changelog: 'https://toolknit.com/changelog.html', github: 'https://github.com/ZihangDong/toolknit-desktop' };
    const url = urls[button.dataset.donationLink];
    if (url) void openExternalUrl?.(url);
  }));
  lifecycle.event(overlay.querySelector('[data-donation-top]'), 'click', () => {
    scroll?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  lifecycle.event(window, 'pagehide', close);

  return {
    open,
    close,
    getBackground: () => currentBackground,
    dispose() {
      close();
      lifecycle.dispose();
    }
  };
}

