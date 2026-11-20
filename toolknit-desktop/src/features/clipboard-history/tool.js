import { createClipboardHistoryController } from './controller.js';
import '../../styles/components/hardware-workbench.css';

import '../../styles/components/tool-custom-select.css';
import './clipboard-history.css';

export function initClipboardHistoryTool(context) { return createClipboardHistoryController(context); }
