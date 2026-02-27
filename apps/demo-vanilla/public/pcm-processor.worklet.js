/**
 * AudioWorklet processor: captures raw PCM from mic, resamples to 16kHz mono,
 * and posts 80ms frames (1280 samples) to the main thread.
 */

const TARGET_SAMPLE_RATE = 16000;
const FRAME_DURATION_MS = 80;
const FRAME_SIZE = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 1280

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.active = true;
    this.buffer = new Float32Array(0);
    this.inputSampleRate = sampleRate;
    this.resampleRatio = TARGET_SAMPLE_RATE / this.inputSampleRate;

    this.port.onmessage = (e) => {
      if (e.data.type === 'start') {
        this.active = true;
        this.buffer = new Float32Array(0);
      } else if (e.data.type === 'stop') {
        this.active = false;
        this.buffer = new Float32Array(0);
      }
    };
  }

  process(inputs, _outputs, _parameters) {
    if (!this.active) return true;

    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const raw = input[0];
    const resampled = this.resample(raw);

    const newBuffer = new Float32Array(this.buffer.length + resampled.length);
    newBuffer.set(this.buffer, 0);
    newBuffer.set(resampled, this.buffer.length);
    this.buffer = newBuffer;

    while (this.buffer.length >= FRAME_SIZE) {
      const frame = this.buffer.slice(0, FRAME_SIZE);
      this.buffer = this.buffer.slice(FRAME_SIZE);
      this.port.postMessage({ type: 'pcm-frame', frame }, [frame.buffer]);
    }

    return true;
  }

  resample(input) {
    if (this.inputSampleRate === TARGET_SAMPLE_RATE) {
      return input;
    }

    const outputLength = Math.round(input.length * this.resampleRatio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / this.resampleRatio;
      const srcFloor = Math.floor(srcIndex);
      const srcCeil = Math.min(srcFloor + 1, input.length - 1);
      const frac = srcIndex - srcFloor;
      output[i] = input[srcFloor] * (1 - frac) + input[srcCeil] * frac;
    }

    return output;
  }
}

registerProcessor('voicepage-pcm-processor', PcmProcessor);
