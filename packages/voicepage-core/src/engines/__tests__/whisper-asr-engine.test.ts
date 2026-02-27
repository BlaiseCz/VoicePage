/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSession } from './ort-mock.js';
import type { InferenceSession } from 'onnxruntime-web';

// Mock fetch for tokenizer loading
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock onnxruntime-web before importing the engine
vi.mock('onnxruntime-web', () => {
  return {
    env: { wasm: { numThreads: 1 } },
    InferenceSession: {
      create: vi.fn(),
    },
    Tensor: class MockTensor {
      type: string;
      data: ArrayBufferView;
      dims: readonly number[];
      constructor(type: string, data: ArrayBufferView, dims: readonly number[]) {
        this.type = type;
        this.data = data;
        this.dims = dims;
      }
    },
  };
});

import { WhisperAsrEngine } from '../whisper-asr-engine.js';
import * as ort from 'onnxruntime-web';

// Whisper constants
const N_MELS = 80;
const N_FRAMES = 3000;
const HIDDEN_DIM = 384;
const VOCAB_SIZE = 51865;
const EOT_TOKEN = 50257;

describe('WhisperAsrEngine', () => {
  let encoderSession: InferenceSession;
  let decoderSession: InferenceSession;
  let decoderCallCount: number;

  function makeEncoderSession() {
    return createMockSession({
      inputNames: ['input_features'],
      outputNames: ['last_hidden_state'],
      onRun: () => {
        // Output: [1, 1500, 384]
        return {
          last_hidden_state: {
            data: new Float32Array(1500 * HIDDEN_DIM),
            dims: [1, 1500, HIDDEN_DIM],
          },
        };
      },
    });
  }

  function makeDecoderSession(tokenSequence: number[]) {
    decoderCallCount = 0;
    return createMockSession({
      inputNames: ['input_ids', 'encoder_hidden_states'],
      outputNames: ['logits'],
      onRun: (feeds) => {
        const inputIds = feeds.input_ids;
        const seqLen = Number(inputIds.dims[1]);
        decoderCallCount++;

        // Build logits: [1, seqLen, VOCAB_SIZE]
        const logits = new Float32Array(seqLen * VOCAB_SIZE);
        // Set the argmax of the last position's logits to the next token
        const tokenIdx = decoderCallCount - 1;
        const nextToken = tokenIdx < tokenSequence.length
          ? tokenSequence[tokenIdx]
          : EOT_TOKEN;

        // Set the target token logit high in the last position
        const lastPosOffset = (seqLen - 1) * VOCAB_SIZE;
        logits[lastPosOffset + nextToken] = 10.0;

        return {
          logits: { data: logits, dims: [1, seqLen, VOCAB_SIZE] },
        };
      },
    });
  }

  function makeTokenizerVocab(mapping: Record<string, number>) {
    return { vocab: mapping };
  }

  beforeEach(() => {
    decoderCallCount = 0;
    encoderSession = makeEncoderSession();
    decoderSession = makeDecoderSession([EOT_TOKEN]); // Default: immediate EOT

    vi.mocked(ort.InferenceSession.create)
      .mockReset()
      .mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('encoder')) return encoderSession;
        return decoderSession;
      });

    // Default: no tokenizer URL
    mockFetch.mockReset();
  });

  function createEngine(opts?: { tokenizerUrl?: string; maxTokens?: number }) {
    return new WhisperAsrEngine({
      encoderModelUrl: '/models/whisper/whisper-tiny-encoder.onnx',
      decoderModelUrl: '/models/whisper/whisper-tiny-decoder.onnx',
      tokenizerUrl: opts?.tokenizerUrl,
      maxTokens: opts?.maxTokens ?? 128,
    });
  }

  // --- Lifecycle tests ---

  describe('lifecycle', () => {
    it('should load encoder and decoder on init', async () => {
      const engine = createEngine();
      await engine.init();

      expect(ort.InferenceSession.create).toHaveBeenCalledTimes(2);
      expect(ort.InferenceSession.create).toHaveBeenCalledWith(
        '/models/whisper/whisper-tiny-encoder.onnx',
        expect.objectContaining({ executionProviders: ['wasm'] }),
      );
      expect(ort.InferenceSession.create).toHaveBeenCalledWith(
        '/models/whisper/whisper-tiny-decoder.onnx',
        expect.objectContaining({ executionProviders: ['wasm'] }),
      );
    });

    it('should load tokenizer when URL is provided', async () => {
      const vocab = makeTokenizerVocab({ hello: 100, world: 200 });
      mockFetch.mockResolvedValue({
        json: async () => vocab,
      });

      const engine = createEngine({ tokenizerUrl: '/models/whisper/tokenizer.json' });
      await engine.init();

      expect(mockFetch).toHaveBeenCalledWith('/models/whisper/tokenizer.json');
    });

    it('should release sessions on destroy', async () => {
      const engine = createEngine();
      await engine.init();
      engine.destroy();

      expect(encoderSession.release).toHaveBeenCalled();
      expect(decoderSession.release).toHaveBeenCalled();
    });

    it('should throw if transcribe called before init', async () => {
      const engine = createEngine();
      await expect(engine.transcribe(new Float32Array(16000))).rejects.toThrow(
        'WhisperAsrEngine not initialized',
      );
    });
  });

  // --- Transcription flow ---

  describe('transcription', () => {
    it('should return empty string for empty audio', async () => {
      const engine = createEngine();
      await engine.init();

      const result = await engine.transcribe(new Float32Array(0));
      expect(result).toBe('');
    });

    it('should run encoder then decoder', async () => {
      const engine = createEngine();
      await engine.init();

      // 1 second of audio
      await engine.transcribe(new Float32Array(16000));

      expect(encoderSession.run).toHaveBeenCalledTimes(1);
      expect(decoderSession.run).toHaveBeenCalledTimes(1); // Immediate EOT
    });

    it('should pass correct encoder input shape [1, 80, 3000]', async () => {
      const engine = createEngine();
      await engine.init();

      await engine.transcribe(new Float32Array(16000));

      const calls = vi.mocked(encoderSession.run).mock.calls;
      const feeds = calls[0][0] as Record<string, { dims: readonly number[] }>;
      const inputTensor = feeds.input_features;
      expect(inputTensor.dims).toEqual([1, N_MELS, N_FRAMES]);
    });

    it('should pass input_ids and encoder_hidden_states to decoder', async () => {
      const engine = createEngine();
      await engine.init();

      await engine.transcribe(new Float32Array(16000));

      const calls = vi.mocked(decoderSession.run).mock.calls;
      const feeds = calls[0][0] as Record<string, unknown>;
      expect(feeds).toHaveProperty('input_ids');
      expect(feeds).toHaveProperty('encoder_hidden_states');
    });

    it('should stop decoding at EOT token', async () => {
      // Produce 3 tokens then EOT
      decoderSession = makeDecoderSession([100, 200, 300, EOT_TOKEN]);
      vi.mocked(ort.InferenceSession.create).mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('encoder')) return encoderSession;
        return decoderSession;
      });

      const engine = createEngine();
      await engine.init();

      await engine.transcribe(new Float32Array(16000));

      // 3 real tokens + 1 EOT = 4 decoder calls
      expect(decoderCallCount).toBe(4);
    });

    it('should respect maxTokens limit', async () => {
      // Never produce EOT — should be capped by maxTokens
      // Use a token far from EOT to avoid accidental matches
      const alwaysToken = 42;
      decoderCallCount = 0;
      decoderSession = createMockSession({
        inputNames: ['input_ids', 'encoder_hidden_states'],
        outputNames: ['logits'],
        onRun: (feeds) => {
          const seqLen = Number(feeds.input_ids.dims[1]);
          decoderCallCount++;
          const logits = new Float32Array(seqLen * VOCAB_SIZE);
          // Set a non-EOT token very high at the last position
          const lastPosOffset = (seqLen - 1) * VOCAB_SIZE;
          logits[lastPosOffset + alwaysToken] = 100.0;
          // Ensure EOT is very negative
          logits[lastPosOffset + EOT_TOKEN] = -100.0;
          return {
            logits: { data: logits, dims: [1, seqLen, VOCAB_SIZE] },
          };
        },
      });
      vi.mocked(ort.InferenceSession.create).mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('encoder')) return encoderSession;
        return decoderSession;
      });

      const engine = createEngine({ maxTokens: 5 });
      await engine.init();

      await engine.transcribe(new Float32Array(16000));

      expect(decoderCallCount).toBe(5);
    });
  });

  // --- Tokenizer ---

  describe('tokenizer', () => {
    it('should decode tokens using vocab', async () => {
      const vocab = makeTokenizerVocab({
        'Ġhello': 100,
        'Ġworld': 200,
      });
      mockFetch.mockResolvedValue({ json: async () => vocab });

      decoderSession = makeDecoderSession([100, 200, EOT_TOKEN]);
      vi.mocked(ort.InferenceSession.create).mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('encoder')) return encoderSession;
        return decoderSession;
      });

      const engine = createEngine({ tokenizerUrl: '/tokenizer.json' });
      await engine.init();

      const result = await engine.transcribe(new Float32Array(16000));

      // "Ġhello" + "Ġworld" → " hello world" → trimmed → "hello world"
      expect(result).toBe('hello world');
    });
  });

  // --- Mel spectrogram ---

  describe('mel spectrogram', () => {
    it('should handle short audio by padding to 3000 frames', async () => {
      const engine = createEngine();
      await engine.init();

      // Very short audio: 0.1s = 1600 samples
      await engine.transcribe(new Float32Array(1600));

      // Should still produce [1, 80, 3000] encoder input
      const calls = vi.mocked(encoderSession.run).mock.calls;
      const feeds = calls[0][0] as Record<string, { dims: readonly number[] }>;
      expect(feeds.input_features.dims).toEqual([1, N_MELS, N_FRAMES]);
    });

    it('should handle long audio by trimming to 3000 frames', async () => {
      const engine = createEngine();
      await engine.init();

      // 31s of audio (just over Whisper's 30s window, but not so big it times out)
      await engine.transcribe(new Float32Array(16000 * 31));

      const calls = vi.mocked(encoderSession.run).mock.calls;
      const feeds = calls[0][0] as Record<string, { dims: readonly number[] }>;
      expect(feeds.input_features.dims).toEqual([1, N_MELS, N_FRAMES]);
    }, 30_000);
  });
});
