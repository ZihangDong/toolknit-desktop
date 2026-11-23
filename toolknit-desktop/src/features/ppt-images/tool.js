import { applyTranslations } from '../../i18n.js';
import '../../styles/components/ppt-workbench.css';

import { createPptImagesController } from './controller.js';
import { pptImagesPageTemplate, pptImagesPortalTemplate } from './template.js';
import './ppt-images.css';


function createPortal() {
  const template = document.createElement('template');
  template.innerHTML = pptImagesPortalTemplate();
  const portal = template.content.firstElementChild;
  if (!portal) throw new Error('ppt-images:missing-portal');
  document.body.append(portal);
  return portal;
}

export function initPptImagesTool(context = {}) {
  const { overlay, refreshIcons = () => {} } = context;
  if (!overlay) throw new Error('ppt-images:missing-overlay');
  overlay.innerHTML = pptImagesPageTemplate();
  const portal = createPortal();
  applyTranslations();
  refreshIcons();
  const controller = createPptImagesController({ ...context, overlay, portal });
  return {
    open: (...args) => controller.open(...args),
    close: (...args) => controller.close(...args),
    dispose() {
      controller.dispose();
      portal.remove();
      overlay.replaceChildren();
    },
    get busy() { return controller.busy; }
  };
}
