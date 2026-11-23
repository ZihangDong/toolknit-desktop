import { applyTranslations } from '../../i18n.js';
import '../../styles/components/ppt-workbench.css';

import { pptCompressPageTemplate, pptCompressPortalTemplate, pptOutlinePageTemplate, pptOutlinePortalTemplate, pptTextPageTemplate, pptTextPortalTemplate } from './template.js';
import { createPptCompressController } from './compress-controller.js';
import { createPptOutlineController } from './outline-controller.js';
import { createPptTextController } from './text-controller.js';
import './ppt-workflows.css';


function createPortal(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  const portal = template.content.firstElementChild;
  if (!portal) throw new Error('ppt-workflows:missing-portal');
  document.body.append(portal);
  return portal;
}

function initialize(context, mode) {
  const { overlay, refreshIcons = () => {} } = context || {};
  if (!overlay) throw new Error(`ppt-${mode}:missing-overlay`);
  const pageMarkup = mode === 'text' ? pptTextPageTemplate() : mode === 'compress' ? pptCompressPageTemplate() : pptOutlinePageTemplate();
  const portalMarkup = mode === 'text' ? pptTextPortalTemplate() : mode === 'compress' ? pptCompressPortalTemplate() : pptOutlinePortalTemplate();
  overlay.innerHTML = pageMarkup;
  const portal = createPortal(portalMarkup);
  applyTranslations();
  refreshIcons();
  const Controller = mode === 'text' ? createPptTextController : mode === 'compress' ? createPptCompressController : createPptOutlineController;
  const controller = Controller({ ...context, overlay, portal });
  return {
    open: (...args) => controller.open(...args),
    close: (...args) => controller.close(...args),
    dispose() { controller.dispose(); portal.remove(); overlay.replaceChildren(); }
  };
}

export function initPptTextTool(context) { return initialize(context, 'text'); }
export function initPptCompressTool(context) { return initialize(context, 'compress'); }
export function initPptOutlineTool(context) { return initialize(context, 'outline'); }
