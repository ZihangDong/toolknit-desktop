import { createMeetingController } from './controller.js';
import { prepareToolPageChrome } from '../../shared/tool-page-chrome.js';
import './meeting.css';
export function initMeetingTool(context) { prepareToolPageChrome(context.overlay); return createMeetingController(context); }
