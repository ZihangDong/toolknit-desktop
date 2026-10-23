import { UTILITY_OPERATIONS } from './utility-tools.mjs';
import { PDF_EXTENSION_OPERATIONS } from './pdf-extension-tools.mjs';
import { IMAGE_EXTENSION_OPERATIONS } from './image-extension-tools.mjs';
import { AI_TEXT_OPERATIONS } from './ai-text-tools.mjs';
import { OFFICE_OPERATIONS } from './office-tools.mjs';
import { FILE_SCAN_OPERATIONS } from './file-scan-tools.mjs';
export const EXTENDED_OPERATIONS = Object.freeze([...UTILITY_OPERATIONS, ...PDF_EXTENSION_OPERATIONS, ...IMAGE_EXTENSION_OPERATIONS, ...AI_TEXT_OPERATIONS, ...OFFICE_OPERATIONS, ...FILE_SCAN_OPERATIONS]);
export const EXTENDED_TOOLS = Object.freeze(EXTENDED_OPERATIONS.map(operation => operation.definition));
export const EXTENDED_HANDLERS = Object.freeze(Object.fromEntries(EXTENDED_OPERATIONS.map(operation => [operation.definition.name,
  async (args, options) => (await import(operation.module))[operation.handler](args, options)])));
