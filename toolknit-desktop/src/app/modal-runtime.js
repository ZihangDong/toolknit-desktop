import { createLifecycleScope } from './tool-lifecycle.js';
import { moveFocusOutOfHiddenRegion } from '../shared/tool-page-shell.js';

const explicitInteractivity = new WeakMap();

/** A visible background can be suspended while a sibling modal owns input. */
export function setModalInteractivity(root, interactive) {
  if (!root) return;
  if (!interactive) moveFocusOutOfHiddenRegion(root);
  explicitInteractivity.set(root, {
    visible: root.classList.contains('visible'),
    interactive: Boolean(interactive)
  });
  root.inert = !interactive;
  root.toggleAttribute?.('inert', !interactive);
  root.setAttribute('aria-hidden', String(!interactive));
}

/** Session-owned focus and background locking for sibling page workspaces. */
export function createModalSession({ root, background, initialFocus, onClose, canClose = () => true, documentRef = root?.ownerDocument || globalThis.document } = {}) {
  let scope = null;
  let returnFocus = null;
  let backgroundInteractive = false;
  const canFocus = node => node && !node.disabled && !node.hidden
    && !node.closest?.('[inert], [hidden]') && (!node.getClientRects || node.getClientRects().length > 0);
  const focusableItems = () => Array.from(root.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'))
    .filter(node => node.tabIndex >= 0 && canFocus(node));

  function close({ restore = true } = {}) {
    if (!scope) return;
    scope.dispose();
    scope = null;
    setModalInteractivity(root, false);
    root.classList.remove('visible');
    setModalInteractivity(background, backgroundInteractive);
    if (restore && returnFocus?.isConnected && !returnFocus.closest('[inert], [aria-hidden="true"]')) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  function open() {
    if (scope || !root) return;
    scope = createLifecycleScope();
    returnFocus = documentRef?.activeElement;
    backgroundInteractive = Boolean(background && !background.inert && background.getAttribute('aria-hidden') !== 'true');
    setModalInteractivity(background, false);
    root.classList.add('visible');
    setModalInteractivity(root, true);
    // A disabled initial command cannot receive focus (for example, install
    // while downloading). Keep keyboard ownership inside the visible modal.
    const focus = canFocus(initialFocus) ? initialFocus : focusableItems()[0];
    if (focus) focus.focus({ preventScroll: true });
    else {
      if (!root.hasAttribute?.('tabindex')) {
        root.setAttribute('tabindex', '-1');
        scope.use(() => root.removeAttribute?.('tabindex'));
      }
      root.focus?.({ preventScroll: true });
    }
    scope.event(documentRef, 'keydown', event => {
      if (root.inert || !root.classList.contains('visible') || (!root.contains(documentRef.activeElement) && !root.contains(event.target)) || !canClose()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      } else if (event.key === 'Tab') {
        const items = focusableItems();
        const index = items.indexOf(documentRef.activeElement);
        if (!items.length || (event.shiftKey ? index <= 0 : index === items.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) : items[0])?.focus({ preventScroll: true });
        }
      }
    }, true);
  }

  return { open, close, dispose: () => close({ restore: false }) };
}

const A11Y_ROOT_SELECTOR = [
  '[id$="Overlay"]',
  '[id$="Workspace"]',
  '[id$="Dialog"]',
  '#pdfMergeSelection',
  '#aiDocStyleInspector'
].join(', ');

const OVERFLOW_ROOT_SELECTOR = [
  '.audio-convert-success-overlay',
  '.audio-clip-success-overlay',
  '.pdf-preview-drawer',
  '.donation-overlay',
  '.transcription-model-overlay',
  '.transcription-gate-overlay',
  '.pdf-editor-edit-modal',
  '#pdfEncryptPasswordDialog',
  '#pdfDecryptPasswordDialog'
].join(', ');

const OVERFLOW_TARGET_SELECTOR = [
  '.audio-convert-success-meta',
  '.audio-convert-success-value',
  '.audio-convert-success-path',
  '.audio-clip-success-meta',
  '.audio-clip-success-path',
  '.cleanup-large-files-success-failures span',
  '.pdf-page-workspace-file',
  '.ppt-render-v2-file',
  '.ppt-images-v2-file',
  '.ppt-text-v2-file',
  '.ppt-compress-v2-file',
  '.transcription-selected-file',
  '.pdf-editor-filecard-name'
].join(', ');

const OVERFLOW_ARIA_SELECTOR = [
  '.audio-convert-success-value',
  '.audio-convert-success-path',
  '.audio-clip-success-path',
  '.pdf-page-workspace-file',
  '.ppt-render-v2-file',
  '.ppt-images-v2-file',
  '.ppt-text-v2-file',
  '.ppt-compress-v2-file',
  '.transcription-selected-file',
  '.pdf-editor-filecard-name'
].join(', ');

const isElement = node => node?.nodeType === 1;

/** Owns modal inert/aria state and overflow metadata observers. */
export function createModalRuntime({ documentRef = globalThis.document } = {}) {
  const observers = [];
  const observedA11yRoots = new WeakSet();

  const focusSafeBeforeClose = event => {
    const target = event?.target;
    const trigger = target?.closest?.([
      '[data-tool-close]', '[id$="Back"]',
      '[data-tool-window="close"]', '[data-ppt-window-action="close"]',
      '.home-v2-window-controls [data-action="close"]'
    ].join(', '));
    if (!trigger) return;
    const region = trigger.closest?.(A11Y_ROOT_SELECTOR);
    const active = documentRef?.activeElement;
    if (region?.contains?.(active)) active.blur?.();
  };
  const focusSafeBeforeEscape = event => {
    if (event.key !== 'Escape') return;
    const region = event.target?.closest?.(A11Y_ROOT_SELECTOR);
    const active = documentRef?.activeElement;
    if (region?.contains?.(active)) active.blur?.();
  };

  const syncA11y = root => {
    if (!isElement(root)) return;
    const visible = root.classList.contains('visible');
    const explicit = explicitInteractivity.get(root);
    const interactive = explicit?.visible === visible ? explicit.interactive : visible;
    // Legacy tools can update visibility and aria state in separate
    // statements. Clear a focused descendant at this shared boundary before
    // applying inert/aria-hidden so the browser never observes a hidden
    // ancestor retaining focus during that transition.
    if (!interactive) {
      const active = documentRef?.activeElement;
      if (root.contains?.(active)) active?.blur?.();
    }
    root.toggleAttribute('inert', !interactive);
    root.setAttribute('aria-hidden', String(!interactive));
  };

  const initA11y = () => {
    const roots = Array.from(documentRef?.querySelectorAll?.(A11Y_ROOT_SELECTOR) || []);
    let observeRoot = () => {};
    let observeAddedNode = () => {};
    let documentObserver = null;

    if (typeof globalThis.MutationObserver === 'function') {
      const observerFactory = () => new globalThis.MutationObserver(entries => {
        entries.forEach(entry => syncA11y(entry.target));
      });
      observeRoot = root => {
        if (!isElement(root) || observedA11yRoots.has(root)) return;
        observedA11yRoots.add(root);
        syncA11y(root);
        const observer = observerFactory();
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        observers.push(observer);
      };
      observeAddedNode = node => {
        if (!isElement(node)) return;
        if (node.matches?.(A11Y_ROOT_SELECTOR)) observeRoot(node);
        node.querySelectorAll?.(A11Y_ROOT_SELECTOR).forEach(observeRoot);
      };

      // Lazy tools mount their overlays after application bootstrap. Observe
      // the document so newly inserted roots receive the same inert and
      // aria-hidden contract before a user can focus one of their controls.
      documentObserver = new globalThis.MutationObserver(entries => {
        entries.forEach(entry => {
          if (entry.type !== 'childList') return;
          entry.addedNodes.forEach(observeAddedNode);
        });
      });
      if (documentRef?.nodeType === 9) {
        documentObserver.observe(documentRef, { childList: true, subtree: true });
        observers.push(documentObserver);
      }
    } else {
      observeRoot = root => {
        if (!isElement(root)) return;
        syncA11y(root);
      };
    }

    roots.forEach(observeRoot);
    // Capture before feature listeners run. A clicked back/close button is
    // focused by the browser before its bubble listener hides the overlay.
    // Clearing that focus here prevents an aria-hidden violation even for
    // legacy tools that do not use the shared close helper yet.
    documentRef?.addEventListener?.('click', focusSafeBeforeClose, true);
    documentRef?.addEventListener?.('keydown', focusSafeBeforeEscape, true);
  };

  const syncOverflowTitle = node => {
    if (!isElement(node) || node.id === 'dependencyGateDesc') return;
    const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const ownsTitle = node.dataset.tkOverflowTitle === '1';
    const ownsAria = node.dataset.tkOverflowAria === '1';
    const clear = () => {
      if (ownsTitle) node.removeAttribute('title');
      if (ownsAria) node.removeAttribute('aria-label');
      delete node.dataset.tkOverflowTitle;
      delete node.dataset.tkOverflowAria;
    };
    if (!value) { clear(); return; }
    const needsHint = value.length >= 28 || /(?:[A-Za-z]:[\\/]|https?:\/\/|\\\\)/.test(value);
    if (!needsHint) { clear(); return; }
    node.setAttribute('title', value);
    node.dataset.tkOverflowTitle = '1';
    if (node.matches(OVERFLOW_ARIA_SELECTOR) && !node.hasAttribute('aria-label')) {
      node.setAttribute('aria-label', value);
      node.dataset.tkOverflowAria = '1';
    } else if (ownsAria) node.setAttribute('aria-label', value);
  };

  const scanOverflow = node => {
    if (!node) return;
    if (node.nodeType === 3) {
      if (node.parentElement?.matches(OVERFLOW_TARGET_SELECTOR)) syncOverflowTitle(node.parentElement);
      return;
    }
    if (!isElement(node)) return;
    if (node.matches(OVERFLOW_TARGET_SELECTOR)) syncOverflowTitle(node);
    node.querySelectorAll?.(OVERFLOW_TARGET_SELECTOR).forEach(syncOverflowTitle);
  };

  const initOverflow = () => {
    const roots = Array.from(documentRef?.querySelectorAll?.(OVERFLOW_ROOT_SELECTOR) || []);
    if (typeof globalThis.MutationObserver !== 'function') {
      roots.forEach(scanOverflow);
      return;
    }
    roots.forEach(root => {
      scanOverflow(root);
      const observer = new globalThis.MutationObserver(records => records.forEach(record => {
        if (record.type === 'characterData') scanOverflow(record.target);
        else {
          scanOverflow(record.target);
          record.addedNodes.forEach(scanOverflow);
        }
      }));
      observer.observe(root, { childList: true, characterData: true, subtree: true });
      observers.push(observer);
    });
  };

  const dispose = () => {
    observers.splice(0).forEach(observer => observer.disconnect());
    documentRef?.removeEventListener?.('click', focusSafeBeforeClose, true);
    documentRef?.removeEventListener?.('keydown', focusSafeBeforeEscape, true);
  };
  return Object.freeze({ dispose, initA11y, initOverflow, scanOverflow, syncA11y, syncOverflowTitle });
}

export { A11Y_ROOT_SELECTOR, OVERFLOW_ARIA_SELECTOR, OVERFLOW_ROOT_SELECTOR, OVERFLOW_TARGET_SELECTOR };
