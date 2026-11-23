import { createIcons, icons } from 'lucide';
import { bindToolPageChrome } from '../../shared/tool-page-shell.js';
import { createColorExtractorController } from './controller.js';
import '../../styles/components/tool-empty-hero.css';
import './color-extractor.css';


export function initColorExtractorTool(context = {}) {
  const { overlay } = context;
  if (!overlay) throw new Error('color-extractor:missing-overlay');
  const refreshIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
  refreshIcons();
  const controller = createColorExtractorController(context);
  let isOpen = false;
  let disposed = false;
  let plasmaDispose = null;
  const background = overlay.querySelector('#colorExtractorBg');
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    controller.close();
    plasmaDispose?.();
    plasmaDispose = null;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  };
  const disposeChrome = bindToolPageChrome(overlay, close);
  return {
    open() {
      if (disposed || isOpen) return;
      isOpen = true;
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      if (background && !plasmaDispose) plasmaDispose = context.initStandardToolPlasma?.(background) || null;
      controller.open();
      refreshIcons();
    },
    close,
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
      controller.dispose();
      disposeChrome();
      overlay.replaceChildren();
    }
  };
}
