import { applyTranslations } from '../../i18n.js';
import '../../styles/components/ppt-workbench.css';

import { createPptRenderController } from './controller.js';
import { pptRenderPageTemplate, pptRenderPortalTemplate } from './template.js';
import './ppt-render.css';


function createPortal(mode) {
  const template = document.createElement('template');
  template.innerHTML = `<div data-ppt-render-portal="${mode}">${pptRenderPortalTemplate(mode)}</div>`;
  const portal = template.content.firstElementChild;
  if (!portal) throw new Error('ppt-render:missing-portal');
  document.body.append(portal);
  return portal;
}

function initialize(context, mode) {
  const { overlay, refreshIcons = () => {} } = context || {};
  if (!overlay) throw new Error(`ppt-render:${mode}:missing-overlay`);
  overlay.innerHTML = pptRenderPageTemplate(mode);
  const portal = createPortal(mode);
  applyTranslations();
  refreshIcons();
  const controller = createPptRenderController({ ...context, overlay, portal, mode });
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

export function initPptToPdfTool(context) {
  return initialize(context, 'pdf');
}

export function initPptToImageTool(context) {
  return initialize(context, 'image');
}
