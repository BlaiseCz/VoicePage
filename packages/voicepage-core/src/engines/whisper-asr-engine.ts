/**
 * Real ASR engine using Whisper ONNX models via onnxruntime-web.
 *
 * Uses whisper-tiny or whisper-base ONNX models for local transcription.
 * The model consists of:
 *   - encoder: processes mel-spectrogram of the audio
 *   - decoder: generates text tokens autoregressively
 *
 * For v1, we use a simplified pipeline:
 *   1. Compute log-mel spectrogram from raw PCM (80-channel, matching Whisper spec)
 *   2. Run encoder to get audio features
 *   3. Run decoder to generate token IDs
 *   4. Decode token IDs to text
 */

import * as ort from 'onnxruntime-web';
import type { IAsrEngine } from '../types.js';

export interface WhisperAsrEngineOptions {
  /** URL or path to whisper encoder ONNX model */
  encoderModelUrl: string;
  /** URL or path to whisper decoder ONNX model */
  decoderModelUrl: string;
  /** URL or path to the tokenizer JSON (vocab + merges) */
  tokenizerUrl?: string;
  /** Language code for forced decoding (default: 'en') */
  language?: string;
  /** Max tokens to generate (default: 128) */
  maxTokens?: number;
}

// Whisper constants
const WHISPER_SAMPLE_RATE = 16000;
const N_FFT = 400;
const HOP_LENGTH = 160;
const N_MELS = 80;
const CHUNK_LENGTH_S = 30; // Whisper processes 30s chunks
const N_FRAMES = CHUNK_LENGTH_S * WHISPER_SAMPLE_RATE / HOP_LENGTH; // 3000

// Special token IDs for whisper-tiny (may vary by model)
const SOT_TOKEN = 50258;
const EOT_TOKEN = 50257;
const TRANSLATE_TOKEN = 50358;
const TRANSCRIBE_TOKEN = 50359;
const NO_TIMESTAMPS_TOKEN = 50363;
const EN_TOKEN = 50259;

export class WhisperAsrEngine implements IAsrEngine {
  private options: WhisperAsrEngineOptions;
  private encoderSession: ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;
  private tokenizer: WhisperTokenizer | null = null;
  private maxTokens: number;

  constructor(options: WhisperAsrEngineOptions) {
    this.options = options;
    this.maxTokens = options.maxTokens ?? 128;
  }

  async init(): Promise<void> {
    ort.env.wasm.numThreads = 1;

    this.encoderSession = await ort.InferenceSession.create(this.options.encoderModelUrl, {
      executionProviders: ['wasm'],
    });

    this.decoderSession = await ort.InferenceSession.create(this.options.decoderModelUrl, {
      executionProviders: ['wasm'],
    });

    // Load tokenizer if provided
    if (this.options.tokenizerUrl) {
      const resp = await fetch(this.options.tokenizerUrl);
      const data = await resp.json();
      this.tokenizer = new WhisperTokenizer(data);
    } else {
      // Use a basic built-in byte-level decoder
      this.tokenizer = new WhisperTokenizer(null);
    }
  }

  async transcribe(audio: Float32Array): Promise<string> {
    if (!this.encoderSession || !this.decoderSession || !this.tokenizer) {
      throw new Error('WhisperAsrEngine not initialized');
    }

    if (audio.length === 0) return '';

    // Step 1: Compute log-mel spectrogram
    const melSpec = computeLogMelSpectrogram(audio);

    // Step 2: Pad/trim to expected length (N_FRAMES = 3000)
    const paddedMel = padOrTrimMel(melSpec, N_FRAMES);

    // Step 3: Encode
    const encoderInput = new ort.Tensor('float32', paddedMel, [1, N_MELS, N_FRAMES]);
    const encoderFeeds: Record<string, ort.Tensor> = {};
    const encoderInputName = this.encoderSession.inputNames[0];
    encoderFeeds[encoderInputName] = encoderInput;
    const encoderResults = await this.encoderSession.run(encoderFeeds);
    const encoderOutputName = this.encoderSession.outputNames[0];
    const audioFeatures = encoderResults[encoderOutputName];

    // Step 4: Decode autoregressively
    const langToken = EN_TOKEN; // English only for v1
    let tokens = [SOT_TOKEN, langToken, TRANSCRIBE_TOKEN, NO_TIMESTAMPS_TOKEN];
    const generatedTokens: number[] = [];

    for (let i = 0; i < this.maxTokens; i++) {
      const decoderInput = new ort.Tensor(
        'int64',
        BigInt64Array.from(tokens.map((t) => BigInt(t))),
        [1, tokens.length],
      );

      const decoderFeeds: Record<string, ort.Tensor> = {
        input_ids: decoderInput,
        encoder_hidden_states: audioFeatures,
      };

      const decoderResults = await this.decoderSession.run(decoderFeeds);
      const logitsOutput = decoderResults[this.decoderSession.outputNames[0]];
      const logits = logitsOutput.data as Float32Array;

      // Get last token logits
      const vocabSize = logits.length / tokens.length;
      const lastLogits = logits.slice((tokens.length - 1) * vocabSize);

      // Greedy decode: pick argmax
      let maxIdx = 0;
      let maxVal = -Infinity;
      for (let j = 0; j < vocabSize; j++) {
        if (lastLogits[j] > maxVal) {
          maxVal = lastLogits[j];
          maxIdx = j;
        }
      }

      if (maxIdx === EOT_TOKEN) break;

      generatedTokens.push(maxIdx);
      tokens.push(maxIdx);
    }

    // Step 5: Decode tokens to text
    return this.tokenizer.decode(generatedTokens);
  }

  destroy(): void {
    this.encoderSession?.release();
    this.decoderSession?.release();
    this.encoderSession = null;
    this.decoderSession = null;
    this.tokenizer = null;
  }
}

/**
 * Minimal Whisper tokenizer (byte-level BPE decoder).
 */
class WhisperTokenizer {
  private vocab: Record<number, string> | null;

  constructor(data: { vocab?: Record<string, number> } | null) {
    if (data?.vocab) {
      // Invert vocab: token_string -> id becomes id -> token_string
      this.vocab = {};
      for (const [str, id] of Object.entries(data.vocab)) {
        this.vocab[id] = str;
      }
    } else {
      this.vocab = null;
    }
  }

  decode(tokens: number[]): string {
    if (this.vocab) {
      return tokens
        .map((t) => this.vocab![t] ?? '')
        .join('')
        .replace(/Ġ/g, ' ')
        .trim();
    }
    // Fallback: byte-level decode (Whisper uses byte-level BPE)
    // Token IDs < 256 correspond directly to bytes
    const bytes: number[] = [];
    for (const t of tokens) {
      if (t < 256) {
        bytes.push(t);
      }
    }
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes)).trim();
    } catch {
      return '';
    }
  }
}

// --- Mel-spectrogram computation ---

/**
 * Compute log-mel spectrogram matching Whisper's preprocessing.
 * Input: Float32Array of 16kHz mono PCM.
 * Output: Float32Array of shape [N_MELS, numFrames].
 */
function computeLogMelSpectrogram(audio: Float32Array): Float32Array {
  // Apply Hann window and compute STFT
  const numFrames = Math.floor((audio.length - N_FFT) / HOP_LENGTH) + 1;
  if (numFrames <= 0) {
    return new Float32Array(N_MELS * 1);
  }

  // Compute power spectrogram
  const fftSize = N_FFT;
  const numBins = fftSize / 2 + 1;
  const powerSpec = new Float32Array(numFrames * numBins);

  const window = hannWindow(fftSize);

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * HOP_LENGTH;
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);

    // Apply window
    for (let i = 0; i < fftSize; i++) {
      real[i] = (offset + i < audio.length ? audio[offset + i] : 0) * window[i];
    }

    // FFT
    fft(real, imag);

    // Power spectrum
    for (let i = 0; i < numBins; i++) {
      powerSpec[frame * numBins + i] = real[i] * real[i] + imag[i] * imag[i];
    }
  }

  // Apply mel filterbank
  const melFilters = createMelFilterbank(WHISPER_SAMPLE_RATE, fftSize, N_MELS);
  const melSpec = new Float32Array(N_MELS * numFrames);

  for (let frame = 0; frame < numFrames; frame++) {
    for (let mel = 0; mel < N_MELS; mel++) {
      let sum = 0;
      for (let bin = 0; bin < numBins; bin++) {
        sum += melFilters[mel * numBins + bin] * powerSpec[frame * numBins + bin];
      }
      // Log mel (clamp to avoid log(0))
      melSpec[mel * numFrames + frame] = Math.log10(Math.max(sum, 1e-10));
    }
  }

  // Normalize: max - 8.0, then / 4.0 (Whisper's normalization)
  let maxVal = -Infinity;
  for (let i = 0; i < melSpec.length; i++) {
    if (melSpec[i] > maxVal) maxVal = melSpec[i];
  }
  for (let i = 0; i < melSpec.length; i++) {
    melSpec[i] = (Math.max(melSpec[i], maxVal - 8.0) + 4.0) / 4.0;
  }

  return melSpec;
}

function padOrTrimMel(mel: Float32Array, targetFrames: number): Float32Array {
  const numMels = N_MELS;
  const currentFrames = mel.length / numMels;
  const result = new Float32Array(numMels * targetFrames);

  for (let m = 0; m < numMels; m++) {
    const copyLen = Math.min(currentFrames, targetFrames);
    for (let f = 0; f < copyLen; f++) {
      result[m * targetFrames + f] = mel[m * currentFrames + f];
    }
    // Remaining frames are zero-padded (already 0 from Float32Array init)
  }

  return result;
}

// --- DSP utilities ---

function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return window;
}

/**
 * In-place radix-2 FFT (Cooley-Tukey).
 * real and imag arrays are modified in place.
 * Length must be a power of 2.
 */
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Zero-pad to next power of 2 if needed (N_FFT=400 isn't power of 2)
  // For non-power-of-2, use DFT directly (less efficient but correct)
  if ((n & (n - 1)) !== 0) {
    dftDirect(real, imag);
    return;
  }

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len *= 2) {
    const halfLen = len / 2;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let j = 0; j < halfLen; j++) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + halfLen] * curReal - imag[i + j + halfLen] * curImag;
        const vImag = real[i + j + halfLen] * curImag + imag[i + j + halfLen] * curReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + halfLen] = uReal - vReal;
        imag[i + j + halfLen] = uImag - vImag;
        const newCurReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newCurReal;
      }
    }
  }
}

/**
 * Direct DFT for non-power-of-2 lengths.
 */
function dftDirect(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  const realOut = new Float32Array(n);
  const imagOut = new Float32Array(n);

  for (let k = 0; k < n; k++) {
    let sumReal = 0;
    let sumImag = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      sumReal += real[t] * Math.cos(angle) - imag[t] * Math.sin(angle);
      sumImag += real[t] * Math.sin(angle) + imag[t] * Math.cos(angle);
    }
    realOut[k] = sumReal;
    imagOut[k] = sumImag;
  }

  real.set(realOut);
  imag.set(imagOut);
}

/**
 * Create mel filterbank matrix.
 */
function createMelFilterbank(
  sampleRate: number,
  fftSize: number,
  numMels: number,
): Float32Array {
  const numBins = fftSize / 2 + 1;
  const filters = new Float32Array(numMels * numBins);

  const fMin = 0;
  const fMax = sampleRate / 2;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);

  // Mel points
  const melPoints = new Float32Array(numMels + 2);
  for (let i = 0; i < numMels + 2; i++) {
    melPoints[i] = melMin + (i * (melMax - melMin)) / (numMels + 1);
  }

  // Convert back to Hz
  const hzPoints = melPoints.map(melToHz);

  // Convert to FFT bin indices
  const binPoints = hzPoints.map((hz) => Math.floor(((fftSize + 1) * hz) / sampleRate));

  for (let mel = 0; mel < numMels; mel++) {
    const left = binPoints[mel];
    const center = binPoints[mel + 1];
    const right = binPoints[mel + 2];

    for (let bin = left; bin < center && bin < numBins; bin++) {
      filters[mel * numBins + bin] = (bin - left) / Math.max(center - left, 1);
    }
    for (let bin = center; bin < right && bin < numBins; bin++) {
      filters[mel * numBins + bin] = (right - bin) / Math.max(right - center, 1);
    }
  }

  return filters;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}
