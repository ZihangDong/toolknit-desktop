import { applyTranslations } from '../../i18n.js';
import { prepareToolPageChrome } from '../../shared/tool-page-chrome.js';
import '../../styles/components/ppt-workbench.css';
import '../../styles/themes/ppt-tools-light.css';
import { createPptDraftController } from './controller.js';
import { pptDraftPageTemplate, pptDraftPortalTemplate } from './template.js';
import './ppt-draft.css';
import './ppt-draft-light.css';

function mountPortal() {
  const portal = document.createElement('div');
  portal.className = 'ppt-draft-portal';
  portal.innerHTML = pptDraftPortalTemplate();
  document.body.append(portal);
  return portal;
}

export function initPptDraftTool(context = {}) {
  const { overlay, refreshIcons = () => {} } = context;
  if (!overlay) throw new Error('ppt-draft:missing-overlay');
  overlay.innerHTML = pptDraftPageTemplate();
  const portal = mountPortal();
  prepareToolPageChrome(portal);
  applyTranslations();
  refreshIcons();
  const controller = createPptDraftController({ ...context, overlay });
  return {
    open: (...args) => controller.open(...args),
    close: (...args) => controller.close(...args),
    importOutline: (...args) => controller.importOutline(...args),
    dispose() {
      controller.dispose();
      portal.remove();
      overlay.replaceChildren();
    },
    get busy() { return controller.busy; }
  };
}
