import { createPdfScanController } from './controller.js';
import './pdf-to-scan.css';

export function initPdfScanTool(context) { return createPdfScanController(context); }
