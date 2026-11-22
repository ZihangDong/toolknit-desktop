const WINDOW_SAMPLES = 128000;

class MeetingAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(WINDOW_SAMPLES);
    this.used = 0;
    this.offset = 0;
    this.peak = 0;
    this.active = false;
    this.port.onmessage = ({ data }) => {
      this.active = data === 'resume';
      if (data === 'finish') {
        this.flush();
        this.port.postMessage({ finished: true });
      }
    };
  }

  flush() {
    if (!this.used) return;
    if (this.peak >= 128) {
      const samples = this.buffer.slice(0, this.used);
      this.port.postMessage({ offset: this.offset, samples }, [samples.buffer]);
    }
    this.offset += this.used;
    this.used = 0;
    this.peak = 0;
  }

  process(inputs, outputs) {
    if (!this.active) return true;
    const channel = inputs[0]?.[0];
    const frames = outputs[0][0].length;
    for (let i = 0; i < frames; i++) {
      const sample = Math.round(Math.max(-1, Math.min(1, channel?.[i] || 0)) * 32767);
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.buffer[this.used++] = sample;
      if (this.used === WINDOW_SAMPLES) this.flush();
    }
    return true;
  }
}

registerProcessor('toolknit-meeting-audio', MeetingAudioProcessor);
