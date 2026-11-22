import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
const tr = key => `data-i18n="home.meeting.${key}"`;
const button = (id, key, icon, extra = '') => `<button id="meeting${id}" type="button" ${extra}>${icon ? `<i data-lucide="${icon}" aria-hidden="true"></i>` : ''}<span ${tr(key)}></span></button>`;
export default `<div id="meetingOverlay" class="meeting-tool pdf-merge-overlay pdf-merge-v2 tool-page-v2-overlay" role="dialog" aria-modal="true" aria-labelledby="meetingTitle" aria-hidden="true" inert>
${toolTopbarMarkup({ tag: 'MEETING · TOOL PAGE 3.4', closeAttr: 'data-meeting-close' })}
<main class="meeting-layout"><section class="meeting-controls" aria-labelledby="meetingTitle">
  <h1 id="meetingTitle" ${tr('title')}></h1><p class="meeting-muted" ${tr('intro')}></p>
  ${button('JumpEditor', 'jumpEditor', 'notebook-text', 'class="meeting-mobile-link"')}
  <div class="meeting-status-row"><p id="meetingStatus" role="status" aria-live="polite"></p>${button('Cancel', 'cancel', 'x', 'hidden')}</div>
  <label for="meetingName" ${tr('name')}></label><input id="meetingName" type="text" maxlength="120" data-i18n-placeholder="home.meeting.namePlaceholder">
  <div class="meeting-record-status" role="status"><strong id="meetingRecordState"></strong><output id="meetingTimer">00:00:00</output></div>
  <label id="meetingLiveOption" class="meeting-live-option" hidden><input id="meetingLive" type="checkbox" aria-describedby="meetingLiveStatus"><span ${tr('live')}></span></label>
  <div class="meeting-buttons">${button('Record', 'record', 'mic', 'data-primary')}${button('Pause', 'pause', 'pause')}${button('Stop', 'stop', 'square')}</div>
  <p id="meetingLiveStatus" role="status" class="meeting-muted" hidden></p>
  <p class="meeting-muted" ${tr('recordLimit')}></p>
  <audio id="meetingAudio" controls preload="metadata" hidden></audio><p id="meetingSource" class="meeting-source"></p>
  <div class="meeting-buttons">${button('SaveAudio', 'saveAudio', 'save')}${button('Pick', 'pick', 'folder-open')}</div>
  <label for="meetingLanguage" ${tr('language')}></label><select id="meetingLanguage"><option value="auto" ${tr('auto')}></option><option value="zh">中文</option><option value="en">English</option></select>
  ${button('Transcribe', 'transcribe', 'captions', 'data-primary')}
  <p class="meeting-muted" ${tr('offline')}></p>
  ${button('Reset', 'reset', 'rotate-ccw')}
</section><section class="meeting-editor" aria-labelledby="meetingEditorTitle">
  <h2 id="meetingEditorTitle" ${tr('editorTitle')}></h2>
  ${button('JumpRecord', 'jumpRecord', 'mic', 'class="meeting-mobile-link"')}
  <div class="meeting-tabs" role="tablist" aria-labelledby="meetingEditorTitle"><button id="meetingTranscriptTab" type="button" role="tab" aria-selected="true" aria-controls="meetingTranscriptPanel" ${tr('transcript')}></button><button id="meetingMinutesTab" type="button" role="tab" aria-selected="false" aria-controls="meetingMinutesPanel" ${tr('minutes')}></button></div>
  <div class="meeting-ai"><div><h2 ${tr('minutesTitle')}></h2><p id="meetingProvider" class="meeting-muted"></p></div>${button('Generate', 'generate', 'notebook-pen')}<p class="meeting-muted" ${tr('aiDisclosure')}></p></div>
  <div id="meetingTranscriptPanel" class="meeting-editor-panel" role="tabpanel" aria-labelledby="meetingTranscriptTab"><label class="meeting-sr" for="meetingTranscript" ${tr('transcript')}></label><textarea id="meetingTranscript" maxlength="500000" data-i18n-placeholder="home.meeting.transcriptPlaceholder" spellcheck="false"></textarea></div>
  <div id="meetingMinutesPanel" class="meeting-editor-panel" role="tabpanel" aria-labelledby="meetingMinutesTab" hidden><label class="meeting-sr" for="meetingMinutes" ${tr('minutes')}></label><textarea id="meetingMinutes" maxlength="100000" spellcheck="false"></textarea></div>
  <p id="meetingStale" class="meeting-muted" ${tr('stale')} hidden></p>
  <div class="meeting-editor-actions">${button('Copy', 'copy', 'copy')}${button('ExportText', 'exportText', 'file-down')}${button('ExportMinutes', 'exportMinutes', 'file-down')}${button('Folder', 'folder', 'folder-open')}</div>
  <div class="meeting-progress" role="progressbar" aria-labelledby="meetingStatus" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div id="meetingProgressFill"></div></div>
</section></main><input id="meetingFileInput" type="file" accept="audio/*,video/*,.txt,.srt" hidden></div>`;
