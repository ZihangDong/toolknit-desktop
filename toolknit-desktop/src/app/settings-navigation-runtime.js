import { createLifecycleScope } from './tool-lifecycle.js';

/** Keep Settings Escape ahead of the suspended tool's document listeners. */
export function createSettingsNavigationRuntime({
  root = globalThis.document,
  windowRef = root?.defaultView,
  settingsOverlay,
  getActivePage = () => null,
  onClose = () => {},
  onError = error => console.error('Settings navigation failed:', error)
} = {}) {
  const scope = createLifecycleScope({ onError });
  if (root?.addEventListener) scope.event(root, 'keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !settingsOverlay?.classList.contains('visible')
      || settingsOverlay.inert || getActivePage() !== settingsOverlay) return;
    const child = settingsOverlay.querySelector('[id$="Overlay"].visible, [id$="Dialog"].visible, [role="dialog"].visible');
    if (child && !child.inert) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve().then(onClose).catch(onError);
  });
  if (windowRef?.addEventListener) scope.event(windowRef, 'pagehide', scope.dispose, { once: true });
  return { dispose: scope.dispose };
}
