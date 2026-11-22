import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MEETING_LIMITS, meetingMessages, meetingTranscript, parseMeetingMinutes, minutesMarkdown, validateMeetingFile, recordingExtension, meetingErrorCode, meetingMinutesChunks, combineMeetingMinutes } from '../src/features/meeting/core.js';
import { createMeetingRecorder } from '../src/features/meeting/recorder.js';
import markup from '../src/features/meeting/template.js';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const transcript = 'Alice will send the report on Friday. We agreed to ship the patch. Budget approval is still pending.';
const response = { summary: 'The patch is approved; budget approval is pending.', decisions: [{ text: 'Ship the patch', evidence: 'We agreed to ship the patch.' }], actions: [{ task: 'Send the report', owner: 'Alice', deadline: 'Friday', evidence: 'Alice will send the report on Friday.' }], openQuestions: ['Budget approval'] };
const parsed = parseMeetingMinutes(JSON.stringify(response), transcript);
assert.equal(parsed.actions[0].owner, 'Alice'); assert.match(minutesMarkdown(parsed, 'Meeting <script>', 'en'), /Evidence/);
assert.match(minutesMarkdown(parsed, 'Meeting <script>', 'en'), /\\<script\\>/);
assert.equal(meetingMessages(transcript, 'Week 1', 'en').length, 2);
assert.throws(() => meetingMessages('x'.repeat(MEETING_LIMITS.aiChars + 1), '', 'zh'), /ai-large/);
const longTranscript = 'a'.repeat(MEETING_LIMITS.aiChars - 1) + '😀' + transcript.repeat(900);
const chunks = meetingMinutesChunks(longTranscript);
assert.equal(chunks.join(''), longTranscript);
assert.ok(chunks.every(chunk => chunk.length <= MEETING_LIMITS.aiChars && !/[\uD800-\uDBFF]$/.test(chunk)));
assert.throws(() => meetingMinutesChunks('x'.repeat(MEETING_LIMITS.longAiChars + 1)), /ai-large/);
const combined = combineMeetingMinutes([parsed, { ...parsed, summary: 'Later discussion.' }]);
assert.equal(combined.actions.length, 1);
assert.match(minutesMarkdown(combined, 'Meeting', 'en'), /pending\.\n\nLater discussion/);
assert.throws(() => parseMeetingMinutes(JSON.stringify({ ...response, actions: [{ ...response.actions[0], owner: 'Bob' }] }), transcript), /evidence/);
assert.throws(() => parseMeetingMinutes(JSON.stringify({ ...response, decisions: [{ text: 'Invented', evidence: 'Not in transcript' }] }), transcript), /evidence/);
assert.throws(() => parseMeetingMinutes('```not JSON```', transcript), /response/);
assert.throws(() => parseMeetingMinutes(JSON.stringify({ ...response, actions: null }), transcript), /response/);
assert.equal(parseMeetingMinutes(JSON.stringify({ ...response, actions: [{ ...response.actions[0], owner: null, deadline: null }] }), transcript).actions[0].owner, null);
assert.equal(meetingTranscript('1\n00:00:00,000 --> 00:00:01,000\n你好', 'test.srt'), '你好');
assert.equal(meetingTranscript('1\n00:00:00,250 --> 00:00:01,000\n你好', 'test.srt', { timestamps: true }), '[00:00:00.250–00:00:01.000] 你好');
assert.throws(() => meetingTranscript('bad subtitles', 'test.srt'), /empty/);
assert.throws(() => meetingTranscript('1\n00:00:00,000 --> 00:00:01,000\nValid\n\nInvalid block', 'test.srt'), /file/);
assert.equal(meetingErrorCode(new Error('Another file conversion is already in progress')), 'busy');
assert.throws(() => validateMeetingFile({ name: 'x.wav', size: MEETING_LIMITS.mediaBytes + 1 }), /file-large/);
assert.throws(() => validateMeetingFile({ name: 'x.txt', size: MEETING_LIMITS.transcriptBytes + 1 }), /file-large/);
assert.equal(validateMeetingFile({ name: 'x.WEBM', size: 100 }), 'media');
assert.equal(recordingExtension('audio/mp4;codecs=mp4a'), 'm4a');

function stream() { const track = { readyState: 'live', stopped: 0, stop() { this.stopped++; this.readyState = 'ended'; } }; return { track, getTracks: () => [track], getAudioTracks: () => [track] }; }
class Recorder {
  static latest;
  static isTypeSupported(type) { return type.includes('webm'); }
  constructor(input, options) { this.state = 'inactive'; this.mimeType = options.mimeType; Recorder.latest = this; }
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  emit(text = 'audio') { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
  stop() { this.state = 'inactive'; queueMicrotask(() => { this.emit(); this.onstop?.(); }); }
}
let clock = 0, results = [], errors = [], states = [], input = stream();
const recorder = createMeetingRecorder({ mediaDevices: { getUserMedia: async () => input }, Recorder, now: () => clock, onState: state => states.push(state), onResult: result => results.push(result), onError: error => errors.push(error) });
await recorder.start(); clock = 1000; recorder.pause(); clock = 5000; recorder.pause(); clock = 7000; recorder.stop(); await tick();
assert.equal(results[0].elapsed, 3000, 'paused time is excluded'); assert.ok(results[0].blob.size); assert.equal(input.track.stopped, 1);
assert.equal(recorder.state, 'idle'); assert.deepEqual(errors, []);
input = stream(); await recorder.start(); Recorder.latest.emit(); input.track.onended(); await tick();
assert.equal(results[1].reason, 'device'); assert.equal(input.track.stopped, 1);
recorder.dispose();

let resolvePermission, late = stream();
const waiting = createMeetingRecorder({ mediaDevices: { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve; }) }, Recorder });
const start = waiting.start(); assert.equal(waiting.state, 'requesting'); waiting.stop(); resolvePermission(late); await start;
assert.equal(late.track.stopped, 1, 'cancelled permission request releases a late stream'); waiting.dispose();
const denied = createMeetingRecorder({ mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } }, Recorder, onError: error => errors.push(error) });
await denied.start(); assert.equal(errors.at(-1).name, 'NotAllowedError'); denied.dispose();
const limitStream = stream();
const bounded = createMeetingRecorder({ mediaDevices: { getUserMedia: async () => limitStream }, Recorder,
  limits: { ...MEETING_LIMITS, recordingBytes: 12 }, onResult: result => results.push(result) });
await bounded.start(); Recorder.latest.emit('12345678'); Recorder.latest.emit('12345678'); await tick();
assert.ok(results.at(-1).blob.size <= 12); assert.equal(results.at(-1).reason, 'size-limit'); bounded.dispose();
const timed = createMeetingRecorder({ mediaDevices: { getUserMedia: async () => stream() }, Recorder,
  limits: { ...MEETING_LIMITS, durationMs: 20 }, onResult: result => results.push(result) });
await timed.start(); await new Promise(resolve => setTimeout(resolve, 260)); assert.equal(results.at(-1).reason, 'duration-limit'); timed.dispose();

const zh = JSON.parse(await readFile('src/locales/zh.json')), en = JSON.parse(await readFile('src/locales/en.json'));
const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [[prefix + key, item]] : flatten(item, prefix + key + '.'));
const chinese = new Map(flatten(zh.home.meeting)), english = new Map(flatten(en.home.meeting));
assert.deepEqual([...chinese.keys()].sort(), [...english.keys()].sort());
for (const [key, value] of chinese) assert.deepEqual(value.match(/\{\w+\}/g) || [], english.get(key).match(/\{\w+\}/g) || []);
for (const key of markup.matchAll(/home\.meeting\.([\w.-]+)/g)) assert.ok(chinese.has(key[1]), key[1]);
const ids = [...markup.matchAll(/id="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
assert.equal((await LAZY_TOOL_SPECS['meeting-notes'].markup()).default, markup);
console.log('Meeting core: grounded minutes, file limits, pause/resume, device loss, late permissions, recording limits and bilingual registration passed.');
