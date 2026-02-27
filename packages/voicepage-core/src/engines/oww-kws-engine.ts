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
 */

import * as ort from 'onnxruntime-web';
import type { IKwsEngine, Keyword } from '../types.js';

export interface OwwKwsEngineOptions {
  /** URL or path to melspectrogram.onnx */
  melModelUrl: string;
  /** URL or path to embedding_model.onnx */
  embeddingModelUrl: string;
  /** Map of keyword name -> URL/path to keyword classifier .onnx */
  keywordModelUrls: Partial<Record<Keyword, string>>;
  /** Per-keyword activation thresholds (default: 0.5 for all) */
  thresholds?: Partial<Record<Keyword, number>>;
  /** Default threshold if not specified per-keyword */
  defaultThreshold?: number;
}

// openWakeWord actual model shapes:
//   mel:       input [batch, samples]  -> output [1, 1, N_mel, 32]  (5 mel frames per 80ms)
//   embedding: input [1, 76, 32, 1]   -> output [1, 1, 1, 96]
//   keyword:   input [1, 16, 96]      -> output [1, 1]
const N_MEL_FRAMES_PER_EMBEDDING = 76;
const N_EMBEDDINGS_PER_KEYWORD = 16;
const EMBEDDING_DIM = 96;

export class OwwKwsEngine implements IKwsEngine {
  private options: OwwKwsEngineOptions;
  private melSession: ort.InferenceSession | null = null;
  private embeddingSession: ort.InferenceSession | null = null;
  private keywordSessions: Map<Keyword, ort.InferenceSession> = new Map();
  private callback: ((keyword: Keyword, confidence: number) => void) | null = null;
  private running = false;

  private defaultThreshold: number;
  private thresholds: Partial<Record<Keyword, number>>;

  // Ring buffer of mel-spectrogram features (each is a 32-dim mel frame)
  private melBuffer: Float32Array[] = [];

  // Ring buffer of embeddings (each is a 96-dim vector)
  private embeddingBuffer: Float32Array[] = [];

  constructor(options: OwwKwsEngineOptions) {
    this.options = options;
    this.defaultThreshold = options.defaultThreshold ?? 0.5;
    this.thresholds = options.thresholds ?? {};
  }

  async init(): Promise<void> {
    // Configure ONNX Runtime for WASM backend
    ort.env.wasm.numThreads = 1;

    // Load mel-spectrogram model
    this.melSession = await ort.InferenceSession.create(this.options.melModelUrl, {
      executionProviders: ['wasm'],
    });

    // Load embedding model
    this.embeddingSession = await ort.InferenceSession.create(this.options.embeddingModelUrl, {
      executionProviders: ['wasm'],
    });

    // Load keyword classifier models
    for (const [keyword, url] of Object.entries(this.options.keywordModelUrls)) {
      if (url) {
        const session = await ort.InferenceSession.create(url, {
          executionProviders: ['wasm'],
        });
        this.keywordSessions.set(keyword as Keyword, session);
      }
    }
  }

  start(onKeyword: (keyword: Keyword, confidence: number) => void): void {
    this.callback = onKeyword;
    this.running = true;
    this.melBuffer = [];
    this.embeddingBuffer = [];
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
      // Step 1: Mel-spectrogram — produces multiple mel frames per audio frame
      const melFrames = await this.computeMelSpectrogram(frame);
      for (const mf of melFrames) {
        this.melBuffer.push(mf);
      }

      // Cap buffer to avoid unbounded growth
      while (this.melBuffer.length > N_MEL_FRAMES_PER_EMBEDDING * 2) {
        this.melBuffer.shift();
      }

      // Need at least 76 mel frames before we can compute an embedding
      if (this.melBuffer.length < N_MEL_FRAMES_PER_EMBEDDING) return;

      // Step 2: Compute embedding from the last 76 mel frames
      const embedding = await this.computeEmbedding();
      this.embeddingBuffer.push(embedding);

      // Cap embedding buffer
      while (this.embeddingBuffer.length > N_EMBEDDINGS_PER_KEYWORD * 2) {
        this.embeddingBuffer.shift();
      }

      // Need 16 embeddings before we can classify
      if (this.embeddingBuffer.length < N_EMBEDDINGS_PER_KEYWORD) return;

      // Step 3: Keyword classification using last 16 embeddings
      await this.classifyKeywords();
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
    this.melBuffer = [];
    this.embeddingBuffer = [];
  }

  /**
   * Run mel-spectrogram model on an 80ms audio frame.
   * Returns an array of mel frames (each 32-dim Float32Array).
   * Typical output: 5 mel frames per 80ms audio frame.
   */
  private async computeMelSpectrogram(frame: Float32Array): Promise<Float32Array[]> {
    if (!this.melSession) throw new Error('Mel session not initialized');

    // Input: [1, 1280]
    const inputTensor = new ort.Tensor('float32', frame, [1, frame.length]);
    const inputName = this.melSession.inputNames[0];
    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const results = await this.melSession.run(feeds);
    const outputName = this.melSession.outputNames[0];
    const output = results[outputName];

    // Output shape: [1, 1, N_mel, 32]
    const data = output.data as Float32Array;
    const dims = output.dims; // e.g. [1, 1, 5, 32]
    const nMelFrames = Number(dims[2]);
    const melDim = Number(dims[3]); // 32

    const melFrames: Float32Array[] = [];
    for (let i = 0; i < nMelFrames; i++) {
      melFrames.push(new Float32Array(data.buffer, data.byteOffset + i * melDim * 4, melDim));
    }
    return melFrames;
  }

  /**
   * Compute embedding from the last 76 mel frames.
   * Input shape: [1, 76, 32, 1]
   * Output shape: [1, 1, 1, 96] → flattened to 96-dim.
   */
  private async computeEmbedding(): Promise<Float32Array> {
    if (!this.embeddingSession) throw new Error('Embedding session not initialized');

    const melDim = 32;
    const stacked = new Float32Array(N_MEL_FRAMES_PER_EMBEDDING * melDim);
    const startIdx = this.melBuffer.length - N_MEL_FRAMES_PER_EMBEDDING;
    for (let i = 0; i < N_MEL_FRAMES_PER_EMBEDDING; i++) {
      stacked.set(this.melBuffer[startIdx + i], i * melDim);
    }

    // Shape: [1, 76, 32, 1]
    const inputTensor = new ort.Tensor('float32', stacked, [1, N_MEL_FRAMES_PER_EMBEDDING, melDim, 1]);
    const inputName = this.embeddingSession.inputNames[0];
    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const results = await this.embeddingSession.run(feeds);
    const outputName = this.embeddingSession.outputNames[0];
    const output = results[outputName];
    // Output: [1, 1, 1, 96] → flatten to [96]
    return new Float32Array(output.data as Float32Array);
  }

  /**
   * Classify keywords using the last 16 embeddings.
   * Input shape: [1, 16, 96]
   */
  private async classifyKeywords(): Promise<void> {
    // Stack last 16 embeddings into [1, 16, 96]
    const stacked = new Float32Array(N_EMBEDDINGS_PER_KEYWORD * EMBEDDING_DIM);
    const startIdx = this.embeddingBuffer.length - N_EMBEDDINGS_PER_KEYWORD;
    for (let i = 0; i < N_EMBEDDINGS_PER_KEYWORD; i++) {
      stacked.set(this.embeddingBuffer[startIdx + i], i * EMBEDDING_DIM);
    }

    for (const [keyword, session] of this.keywordSessions.entries()) {
      const inputName = session.inputNames[0];
      const inputTensor = new ort.Tensor('float32', stacked, [1, N_EMBEDDINGS_PER_KEYWORD, EMBEDDING_DIM]);
      const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
      const results = await session.run(feeds);
      const outputName = session.outputNames[0];
      const scores = results[outputName].data as Float32Array;

      // Output: [1, 1] — single score
      const score = scores[0];
      const threshold = this.thresholds[keyword] ?? this.defaultThreshold;

      if (score >= threshold) {
        this.callback?.(keyword, score);
      }
    }
  }
}
