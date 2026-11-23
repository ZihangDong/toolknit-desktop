import { createOcrEditorController } from './controller.js';
import { prepareToolPageChrome } from '../../shared/tool-page-chrome.js';
import './ocr-editor.css';
export function initOcrEditorTool(context) { prepareToolPageChrome(context.overlay); return createOcrEditorController(context); }
