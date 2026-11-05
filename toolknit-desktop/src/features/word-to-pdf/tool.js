import { createWordPdfController } from './controller.js';
import './word-to-pdf.css';
export function initWordToPdfTool(context) {
  return createWordPdfController(context);
}
