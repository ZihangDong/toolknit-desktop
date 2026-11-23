import { createIcons, icons } from 'lucide';
import { applyTranslations } from '../../i18n.js';
import { createCDriveCleanupController } from './c-drive-controller.js';
import { createLargeFileCleanupController } from './large-file-controller.js';
import './large-file.css';
import './c-drive.css';
import './cleanup-tools.css';

function initialize(context, createController) {
  const { overlay } = context || {};
  if (!overlay) throw new Error('cleanup-tools:missing-overlay');
  applyTranslations();
  createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
  return createController(context);
}

export function initLargeFileCleanupTool(context) {
  return initialize(context, createLargeFileCleanupController);
}

export function initCDriveCleanupTool(context) {
  return initialize(context, createCDriveCleanupController);
}
