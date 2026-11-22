import { MEETING_LIMITS, meetingError } from './core.js';

/** Owns microphone tracks and recorder events; it never writes or uploads audio. */
export function createMeetingRecorder({ mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
  now = () => performance.now(), beforeRecord, onState = () => {}, onResult = () => {}, onError = () => {}, limits = MEETING_LIMITS } = {}) {
  let generation = 0, state = 'idle', owner = null, disposed = false;
  const duration = item => item ? item.elapsed + (state === 'recording' ? now() - item.started : 0) : 0;
  function notify() { onState({ state, elapsed: duration(owner) }); }
  function release(item) {
    clearInterval(item.timer); clearTimeout(item.permissionTimer);
    for (const track of item.stream?.getTracks() || []) { track.onended = null; track.stop(); }
    if (item.recorder) { item.recorder.ondataavailable = null; item.recorder.onstop = null; item.recorder.onerror = null; }
  }
  function fail(item, error) {
    if (owner !== item) return;
    owner = null; generation++; state = 'idle';
    try { if (item.recorder?.state !== 'inactive') item.recorder?.stop(); } catch {}
    item.capture?.dispose(); item.abort.abort();
    release(item); notify(); onError(error);
  }
  function stop(reason = '') {
    const item = owner; if (!item) return;
    if (state === 'requesting') { fail(item, meetingError('cancelled')); return; }
    if (!['recording','paused'].includes(state)) return;
    item.elapsed = duration(item); item.reason = reason; state = 'stopping'; notify();
    item.capture?.finish();
    try { if (item.recorder.state === 'inactive') queueMicrotask(() => item.recorder.onstop?.()); else item.recorder.stop(); } catch (error) { fail(item, error); }
  }
  async function start() {
    if (disposed || state !== 'idle') return;
    if (!mediaDevices?.getUserMedia || !Recorder) { onError(meetingError('unsupported')); return; }
    const item = { token: ++generation, elapsed: 0, bytes: 0, chunks: [], stream: null, recorder: null, abort: new AbortController() };
    owner = item; state = 'requesting'; notify();
    item.permissionTimer = setTimeout(() => { if (owner === item && state === 'requesting') fail(item, meetingError('permission-timeout')); }, 30000);
    try {
      const stream = await mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (disposed || owner !== item || generation !== item.token) { stream.getTracks().forEach(track => track.stop()); return; }
      item.stream = stream;
      if (!stream.getAudioTracks().some(track => track.readyState === 'live')) throw meetingError('device');
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => Recorder.isTypeSupported(type));
      if (!mimeType) throw meetingError('unsupported');
      const recorder = item.recorder = new Recorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      recorder.ondataavailable = event => {
        if (owner !== item || !event.data?.size) return;
        if (item.bytes + event.data.size > limits.recordingBytes) { item.reason = 'size-limit'; stop('size-limit'); return; }
        item.chunks.push(event.data); item.bytes += event.data.size;
        if (item.bytes >= limits.recordingBytes) stop('size-limit');
      };
      recorder.onstop = () => {
        if (owner !== item) return;
        item.elapsed = duration(item);
        const blob = new Blob(item.chunks, { type: recorder.mimeType || mimeType });
        owner = null; state = 'idle'; release(item); notify();
        if (!blob.size) onError(meetingError('empty-audio'));
        else onResult({ blob, elapsed: item.elapsed, reason: item.reason || '' });
      };
      recorder.onerror = () => stop('device');
      for (const track of stream.getTracks()) track.onended = () => stop('device');
      if (beforeRecord) {
        item.capture = await beforeRecord(stream, item.abort.signal);
        if (owner !== item) { item.capture?.dispose(); return; }
      }
      clearTimeout(item.permissionTimer);
      item.started = now(); state = 'recording'; recorder.start(1000); item.capture?.start(); notify();
      item.timer = setInterval(() => { if (owner !== item) return; if (duration(item) >= limits.durationMs) stop('duration-limit'); else notify(); }, 200);
    } catch (error) { if (owner === item) fail(item, error); }
  }
  function pause() {
    if (!owner || !['recording','paused'].includes(state)) return;
    try {
      if (state === 'recording') { owner.elapsed = duration(owner); owner.recorder.pause(); state = 'paused'; }
      else { owner.recorder.resume(); owner.started = now(); state = 'recording'; }
      owner.capture?.pause(state === 'paused');
      notify();
    } catch (error) { fail(owner, error); }
  }
  return { start, pause, stop, get state() { return state; },
    dispose() { if (disposed) return; disposed = true; const item = owner; owner = null; generation++; state = 'idle'; if (item) { item.capture?.dispose(); item.abort.abort(); try { if (item.recorder?.state !== 'inactive') item.recorder?.stop(); } catch {} release(item); } } };
}
