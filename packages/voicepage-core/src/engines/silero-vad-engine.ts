/**
 * Real VAD engine using Silero VAD ONNX model via onnxruntime-web.
 *
 * Silero VAD processes 16kHz audio in chunks (typically 512 samples / 32ms)
 * and outputs a speech probability [0, 1].
 *
 * Speech boundary detection:
 *   - Speech starts when probability exceeds startThreshold for consecutive frames.
 *   - Speech ends when probability drops below endThreshold for silenceDurationMs.
 */

import * as ort from 'onnxruntime-web';
import type { IVadEngine } from '../types.js';

export interface SileroVadEngineOptions {
  /** URL or path to silero_vad.onnx */
  modelUrl: string;
  /** Probability threshold to consider speech started (default: 0.5) */
  startThreshold?: number;
  /** Probability threshold to consider speech ended (default: 0.35) */
  endThreshold?: number;
  /** Duration of silence (ms) before triggering speech end (default: 1000) */
  silenceDurationMs?: number;
  /** Minimum speech duration (ms) before allowing end trigger (default: 250) */
  minSpeechDurationMs?: number;
}

// Silero VAD v5 expects 512 samples at 16kHz (32ms chunks)
const VAD_CHUNK_SIZE = 512;
const VAD_SAMPLE_RATE = 16000;

export class SileroVadEngine implements IVadEngine {
  private options: SileroVadEngineOptions;
  private session: ort.InferenceSession | null = null;

  private startThreshold: number;
  private endThreshold: number;
  private silenceDurationMs: number;
  private minSpeechDurationMs: number;

  // Silero VAD internal state tensors
  private sr: ort.Tensor;
  private state: ort.Tensor;

  // Detection state
  private detecting = false;
  private speechActive = false;
  private speechStartTime = 0;
  private lastSpeechTime = 0;
  private onSpeechStartCb: (() => void) | null = null;
  private onSpeechEndCb: (() => void) | null = null;

  // Internal buffer for accumulating frames into VAD-sized chunks
  private chunkBuffer: Float32Array = new Float32Array(0);

  constructor(options: SileroVadEngineOptions) {
    this.options = options;
    this.startThreshold = options.startThreshold ?? 0.5;
    this.endThreshold = options.endThreshold ?? 0.35;
    this.silenceDurationMs = options.silenceDurationMs ?? 1000;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 250;

    // Initialize state tensors for Silero VAD v5
    // sr is a scalar int64, state is [2, 1, 128] (combined h/c with hidden_size=128)
    this.sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
    this.state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128).fill(0), [2, 1, 128]);
  }

  async init(): Promise<void> {
    ort.env.wasm.numThreads = 1;

    this.session = await ort.InferenceSession.create(this.options.modelUrl, {
      executionProviders: ['wasm'],
    });

    this.resetState();
  }

  startDetection(onSpeechStart: () => void, onSpeechEnd: () => void): void {
    this.detecting = true;
    this.speechActive = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.chunkBuffer = new Float32Array(0);
    this.onSpeechStartCb = onSpeechStart;
    this.onSpeechEndCb = onSpeechEnd;
    this.resetState();
  }

  stopDetection(): void {
    this.detecting = false;
    this.onSpeechStartCb = null;
    this.onSpeechEndCb = null;
    this.chunkBuffer = new Float32Array(0);
  }

  /**
   * Feed a PCM frame from the AudioPipeline (1280 samples = 80ms at 16kHz).
   * Internally splits into 512-sample chunks for Silero VAD.
   */
  async processFrame(frame: Float32Array): Promise<void> {
    if (!this.detecting || !this.session) return;

    // Append to buffer
    const newBuffer = new Float32Array(this.chunkBuffer.length + frame.length);
    newBuffer.set(this.chunkBuffer, 0);
    newBuffer.set(frame, this.chunkBuffer.length);
    this.chunkBuffer = newBuffer;

    // Process complete VAD chunks
    while (this.chunkBuffer.length >= VAD_CHUNK_SIZE) {
      const chunk = this.chunkBuffer.slice(0, VAD_CHUNK_SIZE);
      this.chunkBuffer = this.chunkBuffer.slice(VAD_CHUNK_SIZE);
      await this.processChunk(chunk);
    }
  }

  destroy(): void {
    this.stopDetection();
    this.session?.release();
    this.session = null;
  }

  private async processChunk(chunk: Float32Array): Promise<void> {
    if (!this.session) return;

    try {
      const inputTensor = new ort.Tensor('float32', chunk, [1, VAD_CHUNK_SIZE]);

      const feeds: Record<string, ort.Tensor> = {
        input: inputTensor,
        state: this.state,
        sr: this.sr,
      };

      const results = await this.session.run(feeds);

      // Update combined state tensor
      if (results.stateN) this.state = results.stateN;

      // Get speech probability
      const output = results.output;
      const probability = (output.data as Float32Array)[0];

      this.handleProbability(probability);
    } catch {
      // Skip chunk on error
    }
  }

  private handleProbability(probability: number): void {
    const now = Date.now();

    if (!this.speechActive) {
      // Looking for speech start
      if (probability >= this.startThreshold) {
        this.speechActive = true;
        this.speechStartTime = now;
        this.lastSpeechTime = now;
        this.onSpeechStartCb?.();
      }
    } else {
      // Currently in speech — check for end
      if (probability >= this.endThreshold) {
        this.lastSpeechTime = now;
      } else {
        const silenceDuration = now - this.lastSpeechTime;
        const speechDuration = now - this.speechStartTime;

        if (
          silenceDuration >= this.silenceDurationMs &&
          speechDuration >= this.minSpeechDurationMs
        ) {
          this.speechActive = false;
          this.onSpeechEndCb?.();
        }
      }
    }
  }

  private resetState(): void {
    this.state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128).fill(0), [2, 1, 128]);
  }
}
