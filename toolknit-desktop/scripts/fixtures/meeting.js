import markup from '../../src/features/meeting/template.js';
import { initMeetingTool } from '../../src/features/meeting/tool.js';
import { createTaskCenter } from '../../src/app/task-center.js';
import { applyTheme } from '../../src/app/theme-palette.js';
import { setLangWithoutFade } from '../../src/i18n.js';
import { createIcons, icons } from 'lucide';
const params = new URLSearchParams(location.search);
applyTheme(document.documentElement, { mode: params.get('theme') }); setLangWithoutFade(params.get('lang') || 'zh');
document.body.insertAdjacentHTML('beforeend', markup);
const text = 'Alice will send the report on Friday. We agreed to ship the patch. Budget approval is still pending.';
const valid = { summary: 'The patch was approved; budget approval is pending.', decisions: [{ text: 'Ship the patch', evidence: 'We agreed to ship the patch.' }], actions: [{ task: 'Send the report', owner: 'Alice', deadline: 'Friday', evidence: 'Alice will send the report on Friday.' }], openQuestions: ['Budget approval'] };
const state = window.meetingTest = { calls: [], ai: [], listeners: new Set(), ready: true, key: 'synthetic-key', provider: { url: 'https://fixture.invalid/v1/chat/completions', model: 'fixture-model' }, mode: 'valid', holdSave: false, failSave: false, holdTranscription: false, cancelled: false, transcript: text };
const center = state.center = createTaskCenter({ storage: localStorage });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const controller = state.controller = initMeetingTool({ overlay: document.getElementById('meetingOverlay'), isTauri: params.has('native'), center,
  recorderOptions: { mediaDevices: { getUserMedia: async options => { const stream = await navigator.mediaDevices.getUserMedia(options); (state.streams ||= []).push(stream); return stream; } } },
  getOutputDir: async () => 'QA Meetings', refreshIcons: () => createIcons({ icons }),
  getAiApiKey: async () => state.key, getAiPlatformConfig: () => state.provider,
  ensureFfmpegAvailable: async () => state.ready, activeTranscriptionModel: () => state.ready ? { id: 'fixture' } : null,
  listenNative: async (_name, fn) => { state.listeners.add(fn); return () => state.listeners.delete(fn); },
  invokeNative: async (command, args, options) => {
    state.calls.push({ command, options, size: args?.byteLength, args: args instanceof Uint8Array ? undefined : args });
    if (command === 'check_transcription_engine') return true;
    if (command === 'get_file_size') return 1000;
    if (command === 'open_path') return;
    if (command === 'write_unique_file_binary') {
      while (state.holdSave) await sleep(20);
      if (state.failSave) throw Error('synthetic disk failure');
      const response = await fetch('/__meeting-write', { method: 'POST', body: args, headers: { 'x-toolknit-output': options.headers['x-toolknit-output'] } });
      if (!response.ok) throw Error('fixture write failed'); return (await response.json()).path;
    }
    if (command === 'read_file_bytes_limited') {
      const content = args.path.endsWith('.srt') ? `1\n00:00:00,125 --> 00:00:06,000\n${text}\n` : text;
      return Array.from(new TextEncoder().encode(content));
    }
    if (command === 'start_meeting_recognition') {
      if (state.liveUnavailable) throw Error('synthetic model unavailable');
      return 'meeting-live-fixture';
    }
    if (command === 'transcribe_meeting_segment') {
      (state.liveSegments ||= []).push(args.samples);
      return text;
    }
    if (command === 'stop_meeting_recognition') return;
    if (command === 'cancel_meeting_transcription') { if (args.jobId === state.activeJob) state.cancelled = true; return true; }
    if (command === 'transcribe_meeting_media') {
      state.activeJob = args.jobId; state.cancelled = false;
      for (const fn of state.listeners) fn({ payload: { jobId: 'unrelated-job', phase: 'publishing', progress: 99 } });
      for (const fn of state.listeners) fn({ payload: { jobId: args.jobId, phase: 'transcribing', progress: 15 } });
      await sleep(100);
      while (state.holdTranscription && !state.cancelled) await sleep(20);
      if (state.cancelled) throw Error('transcription:cancelled');
      for (const fn of state.listeners) fn({ payload: { jobId: args.jobId, phase: 'publishing', progress: 95 } });
      state.publicationLocked = document.getElementById('meetingCancel').disabled;
      return { raw_txt_path: 'C:/QA/transcript.txt', raw_srt_path: 'C:/QA/transcript.srt', raw_json_path: 'C:/QA/transcript.json' };
    }
    throw Error('Unexpected command: ' + command);
  },
  requestAi: async (messages, signal, tokens, options) => {
    state.ai.push({ messages, tokens, options });
    if (state.mode === 'chunk' || state.mode === 'chunk-failure') {
      const { transcript } = JSON.parse(messages[1].content);
      if (transcript.includes('Second part.')) {
        if (state.mode === 'chunk-failure') throw Error('synthetic second request failure');
        return JSON.stringify({ summary: 'Second part covered the timeline.', decisions: [], actions: [], openQuestions: [] });
      }
    }
    if (state.mode === 'hold' || state.mode === 'late') return new Promise((resolve, reject) => {
      state.resolveAI = () => resolve(JSON.stringify(valid));
      if (state.mode === 'hold') signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    if (state.mode === 'failure') throw Error('synthetic provider failure');
    if (state.mode === 'bad') return '{"not":"minutes"}';
    if (state.mode === 'evidence') return JSON.stringify({ ...valid, actions: [{ ...valid.actions[0], owner: 'Invented owner' }] });
    return JSON.stringify(valid);
  }
});
state.lang = setLangWithoutFade; state.theme = mode => applyTheme(document.documentElement, { mode });
controller.open();
if (params.has('sample')) { document.getElementById('meetingName').value = 'ToolKnit project review'; document.getElementById('meetingTranscript').value = text; document.getElementById('meetingTranscript').dispatchEvent(new Event('input')); }
