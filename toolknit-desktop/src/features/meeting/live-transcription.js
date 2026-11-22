import processorUrl from './live-audio-processor.js?worker&url';
import { meetingTimestamp } from './core.js';

const SAMPLE_RATE = 16000;
const QUEUE_LIMIT = 4;

export async function prepareLiveTranscription({ stream, invoke, language, onStatus, onText, signal }) {
  const audio = new AudioContext({ sampleRate: SAMPLE_RATE });
  let node, input, sessionId, timer, startupTimer;
  let disposed = false, finished = false, working = false, incomplete = false;
  const queue = [];

  function stopNative(id) {
    void invoke('stop_meeting_recognition', { sessionId: id }).catch(() => {});
  }
  function releaseAudio() {
    clearTimeout(timer);
    if (node) {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
      node = null;
    }
    input?.disconnect();
    input = null;
    if (audio.state !== 'closed') void audio.close().catch(() => {});
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(startupTimer);
    signal.removeEventListener('abort', dispose);
    queue.length = 0;
    releaseAudio();
    if (sessionId) stopNative(sessionId);
  }
  function end(status) {
    if (disposed) return;
    dispose();
    onStatus(status);
  }
  async function drain() {
    if (!sessionId || working || disposed) return;
    working = true;
    try {
      while (queue.length && !disposed) {
        const { offset, samples } = queue.shift();
        const payload = new Int16Array(Math.max(8000, samples.length));
        payload.set(samples);
        const text = await invoke('transcribe_meeting_segment', { sessionId, samples: Array.from(payload) });
        if (disposed) return;
        if (text?.trim()) {
          const start = meetingTimestamp(offset / 16);
          const stop = meetingTimestamp((offset + samples.length) / 16);
          if (onText(`[${start}–${stop}] ${text.trim().replace(/\s*\n\s*/g, ' ')}`) === false) {
            end('incomplete');
            return;
          }
        }
      }
      if (finished && !node) end(incomplete ? 'incomplete' : 'finished');
    } catch {
      end('incomplete');
    } finally {
      working = false;
    }
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    await audio.audioWorklet.addModule(processorUrl);
    await audio.resume();
    if (signal.aborted || audio.state !== 'running') throw new Error('Audio capture is unavailable');
    node = new AudioWorkletNode(audio, 'toolknit-meeting-audio', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    });
    node.onprocessorerror = () => end('incomplete');
    input = audio.createMediaStreamSource(stream);
    input.connect(node);
    // The processor leaves its output silent. Connecting it keeps capture scheduled.
    node.connect(audio.destination);
    node.port.onmessage = ({ data }) => {
      if (disposed) return;
      if (data.finished) {
        releaseAudio();
      } else if (queue.length === QUEUE_LIMIT) {
        incomplete = true;
        if (!finished) onStatus('behind');
      } else {
        queue.push(data);
      }
      void drain();
    };
    return {
      start() {
        if (disposed) return;
        node.port.postMessage('resume');
        onStatus('loading');
        startupTimer = setTimeout(() => end('unavailable'), 30000);
        void invoke('start_meeting_recognition', { language }).then(id => {
          clearTimeout(startupTimer);
          if (disposed) { stopNative(id); return; }
          sessionId = id;
          if (!finished) onStatus(incomplete ? 'behind' : 'listening');
          void drain();
        }).catch(() => end('unavailable'));
      },
      pause(paused) { node?.port.postMessage(paused ? 'pause' : 'resume'); },
      finish() {
        if (disposed || !node) return;
        finished = true;
        onStatus('finishing');
        node.port.postMessage('finish');
        timer = setTimeout(() => {
          incomplete = true;
          releaseAudio();
          void drain();
        }, 1500);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
