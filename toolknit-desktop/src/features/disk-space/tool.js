import { createDiskSpaceController } from './controller.js';
import { prepareToolPageChrome } from '../../shared/tool-page-chrome.js';
import './disk-space.css';
export function initDiskSpaceTool(context) {prepareToolPageChrome(context.overlay);return createDiskSpaceController(context);}
