import { createPdfObjectRemoveController } from './controller.js';
import { prepareToolPageChrome } from '../../shared/tool-page-chrome.js';
import './pdf-object-remove.css';
export function initPdfObjectRemoveTool(context){prepareToolPageChrome(context.overlay);return createPdfObjectRemoveController(context);}
