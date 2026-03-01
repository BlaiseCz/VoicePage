/**
 * Real KWS engine using openWakeWord ONNX models via onnxruntime-web.
 *
 * Architecture (per openWakeWord):
 *   1. Mel-spectrogram preprocessing (melspectrogram.onnx)
 *   2. Shared embedding backbone (embedding_model.onnx)
 *   3. Per-keyword classifier head (open.onnx, click.onnx, etc.)
 *
 * Audio input: 80ms frames of 16kHz Float32 mono PCM (1280 samples).
 * Each frame produces scores per keyword; if score >= threshold, keyword fires.
 *
 * Based on the openWakeWord Python library's AudioFeatures preprocessing:
 *   - Raw audio buffer with 480-sample (30ms) context overlap for mel input
 *   - Mel transform: x/10 + 2 to align ONNX mel output with TF version
 *   - Embedding window: last 76 mel frames → [1, 76, 32, 1]
 *   - Keyword classifier: last 16 embeddings → [1, 16, 96]
 */

import * as ort from 'onnxruntime-web';
import type { IKwsEngine, Keyword } from '../types.js';

export interface OwwKwsEngineOptions {
  /** URL or path to melspectrogram.onnx */
  melModelUrl: string;
  /** URL or path to embedding_model.onnx */
  embeddingModelUrl: string;
  /** Map of keyword name -> URL/path to keyword classifier .onnx */
  keywordModelUrls: Record<string, string>;
  /** Per-keyword activation thresholds (default: 0.5 for all) */
  thresholds?: Record<string, number>;
  /** Default threshold if not specified per-keyword */
  defaultThreshold?: number;
  /** Optional callback to observe every raw score (regardless of threshold). */
  onScore?: (keyword: string, score: number) => void;
  /** Cooldown in ms after a detection before the same keyword can fire again (default: 1500). */
  cooldownMs?: number;
}

// Frame size: 80ms at 16kHz
const FRAME_SIZE = 1280;
// Context overlap: 3 * 160 = 480 samples (30ms) — matches Python lib
const RAW_AUDIO_CONTEXT_SAMPLES = 480;
// Max raw audio buffer: 2 seconds
const MAX_RAW_AUDIO_BUFFER = 16000 * 2;

// Mel spectrogram output dimensions
const MEL_BINS = 32;
const MAX_MEL_BUFFER_FRAMES = 100;

// Embedding model: takes 76 mel frames, outputs 96-dim vector
const EMBEDDING_WINDOW = 76;
const EMBEDDING_DIM = 96;
const MAX_EMBEDDING_BUFFER_FRAMES = 120;

// Keyword classifier: takes last 16 embeddings
const N_EMBEDDINGS_PER_KEYWORD = 16;

export class OwwKwsEngine implements IKwsEngine {
  private options: OwwKwsEngineOptions;
  private melSession: ort.InferenceSession | null = null;
  private embeddingSession: ort.InferenceSession | null = null;
  private keywordSessions: Map<string, ort.InferenceSession> = new Map();
  private callback: ((keyword: string, confidence: number) => void) | null = null;
  private running = false;

  private defaultThreshold: number;
  private thresholds: Record<string, number>;

  // Raw audio accumulation buffer (initialized with silent context)
  private rawAudioBuffer: Float32Array = new Float32Array(RAW_AUDIO_CONTEXT_SAMPLES);

  // Mel-spectrogram frame buffer (each element is MEL_BINS-dim)
  private melBuffer: number[][] = [];

  // Embedding feature buffer (each element is EMBEDDING_DIM-dim)
  private embeddingBuffer: number[][] = [];

  private debugFrameCount = 0;

  // Cooldown: timestamp of last detection per keyword
  private lastDetection: Map<string, number> = new Map();
  private cooldownMs: number;

  constructor(options: OwwKwsEngineOptions) {
    this.options = options;
    this.defaultThreshold = options.defaultThreshold ?? 0.5;
    this.thresholds = options.thresholds ?? {};
    this.cooldownMs = options.cooldownMs ?? 1500;
  }

  async init(): Promise<void> {
    // Configure ONNX Runtime for WASM backend
    ort.env.wasm.numThreads = 1;

    // Load mel-spectrogram model
    this.melSession = await ort.InferenceSession.create(this.options.melModelUrl, {
      executionProviders: ['wasm'],
    });
    console.log('[OWW] mel model inputs:', this.melSession.inputNames, 'outputs:', this.melSession.outputNames);

    // Load embedding model
    this.embeddingSession = await ort.InferenceSession.create(this.options.embeddingModelUrl, {
      executionProviders: ['wasm'],
    });
    console.log('[OWW] embedding model inputs:', this.embeddingSession.inputNames, 'outputs:', this.embeddingSession.outputNames);

    // Load keyword classifier models
    for (const [keyword, url] of Object.entries(this.options.keywordModelUrls)) {
      if (url) {
        const session = await ort.InferenceSession.create(url, {
          executionProviders: ['wasm'],
        });
        this.keywordSessions.set(keyword, session);
        console.log(`[OWW] keyword model '${keyword}' inputs:`, session.inputNames, 'outputs:', session.outputNames);
      }
    }

  }

  start(onKeyword: (keyword: string, confidence: number) => void): void {
    this.callback = onKeyword;
    this.running = true;
    this.rawAudioBuffer = new Float32Array(RAW_AUDIO_CONTEXT_SAMPLES);
    this.melBuffer = [];
    this.embeddingBuffer = [];
    this.lastDetection.clear();
  }

  stop(): void {
    this.running = false;
    this.callback = null;
  }

  /**
   * Feed a single 80ms PCM frame (1280 samples, Float32, 16kHz).
   * This should be called from the AudioPipeline frame listener.
   */
  async processFrame(frame: Float32Array): Promise<void> {
    if (!this.running || !this.melSession || !this.embeddingSession) return;

    try {
      await this.streamInput(frame);
    } catch {
      // Silently skip frame on error — don't crash the pipeline
    }
  }

  destroy(): void {
    this.stop();
    this.melSession?.release();
    this.embeddingSession?.release();
    for (const session of this.keywordSessions.values()) {
      session.release();
    }
    this.melSession = null;
    this.embeddingSession = null;
    this.keywordSessions.clear();
    this.rawAudioBuffer = new Float32Array(RAW_AUDIO_CONTEXT_SAMPLES);
    this.melBuffer = [];
    this.embeddingBuffer = [];
  }

  /**
   * Core streaming pipeline — mirrors the AudioFeatures class from the working project.
   * Accumulates raw audio with context overlap, computes mel → embedding → keyword score.
   */
  private async streamInput(frame: Float32Array): Promise<void> {
    if (!this.melSession || !this.embeddingSession) return;

    // 1. Scale float32 [-1,1] → int16 range [-32768, 32767] (as Float32Array)
    //    This matches openWakeWord's expectation of int16-range PCM.
    const scaled = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i] * 32768;
      scaled[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
    }

    // 2. Append to raw audio buffer
    const combined = new Float32Array(this.rawAudioBuffer.length + scaled.length);
    combined.set(this.rawAudioBuffer);
    combined.set(scaled, this.rawAudioBuffer.length);
    this.rawAudioBuffer = combined;

    // 3. Trim raw audio buffer if too large
    if (this.rawAudioBuffer.length > MAX_RAW_AUDIO_BUFFER) {
      this.rawAudioBuffer = this.rawAudioBuffer.slice(this.rawAudioBuffer.length - MAX_RAW_AUDIO_BUFFER);
    }

    // 4. Extract audio segment for mel: FRAME_SIZE + context overlap
    //    Matches Python: list(raw_data_buffer)[-n_samples - 160*3:]
    const requiredLen = FRAME_SIZE + RAW_AUDIO_CONTEXT_SAMPLES;
    const startIdx = Math.max(0, this.rawAudioBuffer.length - requiredLen);
    const audioForMel = this.rawAudioBuffer.slice(startIdx);

    // 5. Compute mel-spectrogram
    const melInputTensor = new ort.Tensor('float32', audioForMel, [1, audioForMel.length]);
    const melResults = await this.melSession.run({
      [this.melSession.inputNames[0]]: melInputTensor,
    });
    const melOutput = melResults[this.melSession.outputNames[0]];
    const melRaw = melOutput.data as Float32Array;
    const melDims = melOutput.dims;
    const nMelFrames = Number(melDims[2]);
    const melBins = Number(melDims[3]);

    // 6. Apply mel transform: x/10 + 2 (aligns ONNX mel with TF version)
    for (let f = 0; f < nMelFrames; f++) {
      const slice: number[] = [];
      for (let b = 0; b < melBins; b++) {
        const idx = f * melBins + b;
        slice.push(melRaw[idx] / 10 + 2);
      }
      this.melBuffer.push(slice);
    }

    // 7. Cap mel buffer
    if (this.melBuffer.length > MAX_MEL_BUFFER_FRAMES) {
      this.melBuffer = this.melBuffer.slice(-MAX_MEL_BUFFER_FRAMES);
    }

    this.debugFrameCount++;
    if (this.debugFrameCount <= 3) {
      console.log(`[OWW] mel dims:`, Array.from(melDims), `nFrames=${nMelFrames}`,
        `mel[0]:`, this.melBuffer[this.melBuffer.length - nMelFrames]?.slice(0, 4));
    }

    // 8. Compute embedding if we have enough mel frames
    if (this.melBuffer.length < EMBEDDING_WINDOW) return;

    const melWindow = this.melBuffer.slice(-EMBEDDING_WINDOW);
    const flatMel = new Float32Array(melWindow.flat());

    const embInputTensor = new ort.Tensor('float32', flatMel, [1, EMBEDDING_WINDOW, MEL_BINS, 1]);
    const embResults = await this.embeddingSession.run({
      [this.embeddingSession.inputNames[0]]: embInputTensor,
    });
    const embOutput = embResults[this.embeddingSession.outputNames[0]];
    const embData = Array.from(embOutput.data as Float32Array);
    this.embeddingBuffer.push(embData);

    // 9. Cap embedding buffer
    if (this.embeddingBuffer.length > MAX_EMBEDDING_BUFFER_FRAMES) {
      this.embeddingBuffer = this.embeddingBuffer.slice(-MAX_EMBEDDING_BUFFER_FRAMES);
    }

    if (this.debugFrameCount <= 3) {
      console.log(`[OWW] emb dims:`, Array.from(embOutput.dims), `sample:`, embData.slice(0, 4));
    }

    // 10. Classify keywords if we have enough embeddings
    if (this.embeddingBuffer.length < N_EMBEDDINGS_PER_KEYWORD) return;

    await this.classifyKeywords();
  }

  /**
   * Classify keywords using the last 16 embeddings.
   * Input shape: [1, 16, 96]
   */
  private async classifyKeywords(): Promise<void> {
    // Get last 16 embeddings, zero-pad if fewer available
    let buf = this.embeddingBuffer;
    if (buf.length < N_EMBEDDINGS_PER_KEYWORD) {
      const padCount = N_EMBEDDINGS_PER_KEYWORD - buf.length;
      const zeroFrame = new Array(EMBEDDING_DIM).fill(0);
      const padding = Array.from({ length: padCount }, () => zeroFrame);
      buf = padding.concat(buf);
    }
    const sliced = buf.slice(-N_EMBEDDINGS_PER_KEYWORD);
    const stacked = new Float32Array(sliced.flat());

    for (const [keyword, session] of this.keywordSessions.entries()) {
      const inputTensor = new ort.Tensor('float32', stacked, [1, N_EMBEDDINGS_PER_KEYWORD, EMBEDDING_DIM]);
      const results = await session.run({
        [session.inputNames[0]]: inputTensor,
      });
      const outTensor = results[session.outputNames[0]];
      const scores = outTensor.data as Float32Array;
      const score = Math.max(...Array.from(scores));

      if (this.debugFrameCount <= 5) {
        console.log(`[OWW] '${keyword}' score=${score.toFixed(6)}, raw:`, Array.from(scores));
      }

      // Always report raw score to observer (for live visualization)
      this.options.onScore?.(keyword, score);

      const threshold = this.thresholds[keyword] ?? this.defaultThreshold;
      if (score >= threshold) {
        const now = performance.now();
        const last = this.lastDetection.get(keyword) ?? -Infinity;
        if (now - last >= this.cooldownMs) {
          this.lastDetection.set(keyword, now);
          this.callback?.(keyword, score);
        }
      }
    }
  }
}
