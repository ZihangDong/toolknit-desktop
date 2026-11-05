import assert from 'node:assert/strict';
import { initUiSoundController } from '../src/app/ui-sound-controller.js';

// No real sound device: reproduce an interrupted WebView audio clock and
// delayed/rejected resume without depending on the machine's audio driver.
const original = new Map(['window', 'document', 'localStorage', 'Element', 'Node', 'HTMLInputElement', 'CustomEvent', 'performance']
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let now = 1000, initialState = 'running', resumeMode = 'immediate';
const contexts = [];
class Element extends EventTarget { closest() { return this; } matches() { return false; } contains() { return false; } }
class AudioNode extends EventTarget {
  constructor() { super(); this.disconnects = 0; this.stops = 0; this.frequency = this.gain = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  connect() {} disconnect() { this.disconnects++; } start() {} stop() { this.stops++; }
}
class AudioContext extends EventTarget {
  constructor() { super(); this.state = initialState; this.currentTime = 0; this.destination = {}; this.voices = []; this.resumes = 0; this.closes = 0; contexts.push(this); }
  createGain() { return new AudioNode(); }
  createOscillator() { const voice = new AudioNode(); this.voices.push(voice); return voice; }
  resume() {
    this.resumes++;
    if (resumeMode === 'reject') return Promise.reject(new Error('audio device unavailable'));
    if (resumeMode === 'pending') return new Promise(resolve => { this.finishResume = () => { this.state = 'running'; resolve(); }; });
    this.state = 'running'; return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
  close() { this.closes++; this.state = 'closed'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
}
const view = new EventTarget(), doc = new EventTarget();
view.AudioContext = AudioContext; doc.hidden = false;
Object.assign(globalThis, { window: view, document: doc, localStorage: { getItem: () => null, setItem() {} }, Element, Node: Element, HTMLInputElement: Element });
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
if (!globalThis.CustomEvent) globalThis.CustomEvent = class extends Event { constructor(type, options) { super(type); this.detail = options?.detail; } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const play = () => { now += 200; return view.toolknitUiSound.play('hover'); };
const runtimes = [];
const create = () => { const runtime = initUiSoundController(); runtimes.push(runtime); return runtime; };
try {
  const runtime = create();
  assert.equal(contexts.length, 0, 'startup does not open an audio device');
  assert.equal(play(), true);
  const running = contexts.at(-1);
  const first = running.voices[0];
  view.dispatchEvent(new Event('blur'));
  assert.equal(first.disconnects, 1, 'losing focus releases live voices before suspending');
  assert.equal(first.stops, 2, 'scheduled end is replaced by immediate cancellation');
  resumeMode = 'pending';
  for (let i = 0; i < 100; i++) play();
  await tick();
  assert.equal(running.voices.length, 1, 'a suspended clock must not accumulate scheduled nodes');
  assert.equal(running.resumes, 1, 'only one resume may be pending');
  running.finishResume(); await tick();
  assert.equal(play(), true, 'normal feedback resumes after device recovery');
  for (let i = 0; i < 100; i++) play();
  assert.ok(running.voices.filter(voice => voice.disconnects === 0).length <= 8, 'voice count stays bounded even if ended events stall');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(running.voices.filter(voice => voice.disconnects === 0).length, 0, 'stalled audio clocks are released by wall-clock timeout');
  doc.hidden = true;
  const createdBeforeHidden = running.voices.length;
  assert.equal(play(), false, 'hidden UI never creates voices');
  assert.equal(running.voices.length, createdBeforeHidden);
  doc.hidden = false;
  runtime.dispose(); runtime.dispose();
  assert.equal(running.closes, 1, 'dispose closes the audio graph exactly once');
  const beforeDisposed = contexts.length;
  assert.equal(play(), false, 'retained API cannot recreate a disposed audio graph');
  assert.equal(contexts.length, beforeDisposed);

  initialState = 'suspended'; resumeMode = 'reject';
  const failing = create();
  assert.equal(play(), false); await tick();
  const failed = contexts.at(-1);
  assert.equal(failed.closes, 1, 'failed resume releases the unavailable device');
  const failedCount = contexts.length;
  for (let i = 0; i < 5; i++) { play(); await tick(); }
  assert.equal(contexts.length, failedCount, 'failed device retries are backed off');
  now += 6000; initialState = 'running'; resumeMode = 'immediate';
  assert.equal(play(), true, 'later user interaction can recover without changing saved preferences');
  failing.dispose();

  initialState = 'interrupted'; resumeMode = 'pending';
  const late = create();
  assert.equal(play(), false); await tick();
  const interrupted = contexts.at(-1);
  view.dispatchEvent(new Event('blur'));
  interrupted.finishResume(); await tick();
  assert.equal(interrupted.state, 'suspended', 'a delayed resume must not restart audio after blur');
  assert.equal(interrupted.voices.length, 0);
  late.dispose();
  console.log('UI audio: lazy startup, suspended/rejected device, bounded voices, resume deduplication, cleanup and recovery passed');
} finally {
  runtimes.forEach(runtime => runtime.dispose());
  for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
