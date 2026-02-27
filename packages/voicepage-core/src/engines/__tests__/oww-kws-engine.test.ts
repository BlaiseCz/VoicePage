/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSession, mockZeros } from './ort-mock.js';
import type { InferenceSession } from 'onnxruntime-web';

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

import { OwwKwsEngine } from '../oww-kws-engine.js';
import * as ort from 'onnxruntime-web';

// Constants matching the engine internals
const MEL_DIM = 32;
const N_MEL_FRAMES_PER_80MS = 5;
const N_MEL_FRAMES_PER_EMBEDDING = 76;
const N_EMBEDDINGS_PER_KEYWORD = 16;
const EMBEDDING_DIM = 96;
const FRAME_SIZE = 1280;

describe('OwwKwsEngine', () => {
  let melSession: InferenceSession;
  let embeddingSession: InferenceSession;
  let keywordSession: InferenceSession;
  let melRunCount: number;
  let embeddingRunCount: number;
  let keywordRunCount: number;

  function makeMelSession() {
    melRunCount = 0;
    return createMockSession({
      inputNames: ['input'],
      outputNames: ['output'],
      onRun: () => {
        melRunCount++;
        // Output: [1, 1, 5, 32] — 5 mel frames of 32 dims
        return {
          output: mockZeros([1, 1, N_MEL_FRAMES_PER_80MS, MEL_DIM]),
        };
      },
    });
  }

  function makeEmbeddingSession() {
    embeddingRunCount = 0;
    return createMockSession({
      inputNames: ['input_1'],
      outputNames: ['output'],
      onRun: () => {
        embeddingRunCount++;
        // Output: [1, 1, 1, 96]
        return { output: mockZeros([1, 1, 1, EMBEDDING_DIM]) };
      },
    });
  }

  function makeKeywordSession(score = 0.0) {
    keywordRunCount = 0;
    return createMockSession({
      inputNames: ['onnx::Flatten_0'],
      outputNames: ['output'],
      onRun: () => {
        keywordRunCount++;
        // Output: [1, 1]
        return {
          output: { data: new Float32Array([score]), dims: [1, 1] },
        };
      },
    });
  }

  beforeEach(() => {
    melSession = makeMelSession();
    embeddingSession = makeEmbeddingSession();
    keywordSession = makeKeywordSession();

    vi.mocked(ort.InferenceSession.create)
      .mockReset()
      .mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('melspectrogram')) return melSession;
        if (urlStr.includes('embedding')) return embeddingSession;
        return keywordSession;
      });
  });

  function createEngine(opts?: { threshold?: number }) {
    return new OwwKwsEngine({
      melModelUrl: '/models/kws/melspectrogram.onnx',
      embeddingModelUrl: '/models/kws/embedding_model.onnx',
      keywordModelUrls: { open: '/models/kws/test_keyword.onnx' },
      defaultThreshold: opts?.threshold ?? 0.5,
    });
  }

  function makeFrame(): Float32Array {
    return new Float32Array(FRAME_SIZE);
  }

  // --- Lifecycle tests ---

  describe('lifecycle', () => {
    it('should load all three model types on init', async () => {
      const engine = createEngine();
      await engine.init();

      expect(ort.InferenceSession.create).toHaveBeenCalledTimes(3);
      expect(ort.InferenceSession.create).toHaveBeenCalledWith(
        '/models/kws/melspectrogram.onnx',
        expect.objectContaining({ executionProviders: ['wasm'] }),
      );
      expect(ort.InferenceSession.create).toHaveBeenCalledWith(
        '/models/kws/embedding_model.onnx',
        expect.objectContaining({ executionProviders: ['wasm'] }),
      );
      expect(ort.InferenceSession.create).toHaveBeenCalledWith(
        '/models/kws/test_keyword.onnx',
        expect.objectContaining({ executionProviders: ['wasm'] }),
      );
    });

    it('should release all sessions on destroy', async () => {
      const engine = createEngine();
      await engine.init();
      engine.destroy();

      expect(melSession.release).toHaveBeenCalled();
      expect(embeddingSession.release).toHaveBeenCalled();
      expect(keywordSession.release).toHaveBeenCalled();
    });

    it('should not process frames before start', async () => {
      const engine = createEngine();
      await engine.init();

      await engine.processFrame(makeFrame());
      expect(melSession.run).not.toHaveBeenCalled();
    });

    it('should not process frames after stop', async () => {
      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());
      engine.stop();

      await engine.processFrame(makeFrame());
      expect(melSession.run).not.toHaveBeenCalled();
    });
  });

  // --- Mel buffering tests ---

  describe('mel buffering', () => {
    it('should run mel model on each frame', async () => {
      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());

      await engine.processFrame(makeFrame());
      expect(melRunCount).toBe(1);

      await engine.processFrame(makeFrame());
      expect(melRunCount).toBe(2);
    });

    it('should not run embedding until 76 mel frames are accumulated', async () => {
      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());

      // Each frame produces 5 mel frames. Need 76 mel frames → ceil(76/5) = 16 audio frames.
      // After 15 frames: 75 mel frames → no embedding yet
      for (let i = 0; i < 15; i++) {
        await engine.processFrame(makeFrame());
      }
      expect(embeddingRunCount).toBe(0);

      // 16th frame: 80 mel frames → first embedding
      await engine.processFrame(makeFrame());
      expect(embeddingRunCount).toBe(1);
    });

    it('should produce one embedding per frame after accumulation threshold', async () => {
      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());

      // Fill up to threshold (16 frames = 80 mel frames)
      for (let i = 0; i < 16; i++) {
        await engine.processFrame(makeFrame());
      }
      expect(embeddingRunCount).toBe(1);

      // Each subsequent frame should produce an embedding
      await engine.processFrame(makeFrame());
      expect(embeddingRunCount).toBe(2);

      await engine.processFrame(makeFrame());
      expect(embeddingRunCount).toBe(3);
    });
  });

  // --- Embedding stacking tests ---

  describe('embedding stacking', () => {
    it('should not run keyword model until 16 embeddings are accumulated', async () => {
      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());

      // Need 16 embeddings. First embedding at frame 16, then one per frame.
      // So 16 embeddings at frame 16 + 15 = 31.
      // Frames 1-15: no embedding, Frames 16-30: 15 embeddings, Frame 31: 16th embedding
      for (let i = 0; i < 30; i++) {
        await engine.processFrame(makeFrame());
      }
      expect(keywordRunCount).toBe(0);

      // 31st frame → 16th embedding → first keyword classification
      await engine.processFrame(makeFrame());
      expect(keywordRunCount).toBe(1);
    });

    it('should run keyword model on every frame after enough embeddings', async () => {
      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());

      // Warm up: 31 frames to get first keyword run
      for (let i = 0; i < 31; i++) {
        await engine.processFrame(makeFrame());
      }
      expect(keywordRunCount).toBe(1);

      await engine.processFrame(makeFrame());
      expect(keywordRunCount).toBe(2);
    });
  });

  // --- Keyword detection tests ---

  describe('keyword detection', () => {
    it('should fire callback when score exceeds threshold', async () => {
      // Use a keyword session that returns a high score
      keywordSession = makeKeywordSession(0.9);
      vi.mocked(ort.InferenceSession.create).mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('melspectrogram')) return melSession;
        if (urlStr.includes('embedding')) return embeddingSession;
        return keywordSession;
      });

      const engine = createEngine({ threshold: 0.5 });
      await engine.init();
      const onKeyword = vi.fn();
      engine.start(onKeyword);

      // Warm up pipeline (31 frames)
      for (let i = 0; i < 31; i++) {
        await engine.processFrame(makeFrame());
      }

      expect(onKeyword).toHaveBeenCalledTimes(1);
      expect(onKeyword.mock.calls[0][0]).toBe('open');
      expect(onKeyword.mock.calls[0][1]).toBeCloseTo(0.9, 5);
    });

    it('should not fire callback when score is below threshold', async () => {
      keywordSession = makeKeywordSession(0.3);
      vi.mocked(ort.InferenceSession.create).mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('melspectrogram')) return melSession;
        if (urlStr.includes('embedding')) return embeddingSession;
        return keywordSession;
      });

      const engine = createEngine({ threshold: 0.5 });
      await engine.init();
      const onKeyword = vi.fn();
      engine.start(onKeyword);

      for (let i = 0; i < 31; i++) {
        await engine.processFrame(makeFrame());
      }

      expect(onKeyword).not.toHaveBeenCalled();
    });

    it('should respect per-keyword thresholds', async () => {
      keywordSession = makeKeywordSession(0.45);
      vi.mocked(ort.InferenceSession.create).mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('melspectrogram')) return melSession;
        if (urlStr.includes('embedding')) return embeddingSession;
        return keywordSession;
      });

      const engine = new OwwKwsEngine({
        melModelUrl: '/models/kws/melspectrogram.onnx',
        embeddingModelUrl: '/models/kws/embedding_model.onnx',
        keywordModelUrls: { open: '/models/kws/test_keyword.onnx' },
        defaultThreshold: 0.5,
        thresholds: { open: 0.4 }, // Lower threshold for 'open'
      });
      await engine.init();
      const onKeyword = vi.fn();
      engine.start(onKeyword);

      for (let i = 0; i < 31; i++) {
        await engine.processFrame(makeFrame());
      }

      // 0.45 >= 0.4 (per-keyword threshold) → should fire
      expect(onKeyword).toHaveBeenCalledTimes(1);
      expect(onKeyword.mock.calls[0][0]).toBe('open');
      expect(onKeyword.mock.calls[0][1]).toBeCloseTo(0.45, 5);
    });
  });

  // --- Buffer management tests ---

  describe('buffer management', () => {
    it('should clear buffers on start', async () => {
      const engine = createEngine();
      await engine.init();
      const onKeyword = vi.fn();
      engine.start(onKeyword);

      // Process some frames to accumulate mel/embedding buffers
      for (let i = 0; i < 20; i++) {
        await engine.processFrame(makeFrame());
      }
      const embCountBefore = embeddingRunCount;
      expect(embCountBefore).toBeGreaterThan(0);

      // Restart — buffers should be cleared
      engine.stop();
      embeddingRunCount = 0; // Reset our counter
      engine.start(onKeyword);

      // After restart, should need to re-accumulate 76 mel frames (16 audio frames)
      // Process only 1 frame → 5 mel frames, not enough
      await engine.processFrame(makeFrame());
      expect(embeddingRunCount).toBe(0);
    });

    it('should cap mel buffer to avoid unbounded growth', async () => {
      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());

      // Process many frames (200 audio frames = 1000 mel frames)
      for (let i = 0; i < 200; i++) {
        await engine.processFrame(makeFrame());
      }

      // Engine should still function (not OOM or error)
      expect(melRunCount).toBe(200);
    });
  });

  // --- Error resilience ---

  describe('error resilience', () => {
    it('should continue processing after a mel model error', async () => {
      let callCount = 0;
      melSession = createMockSession({
        inputNames: ['input'],
        outputNames: ['output'],
        onRun: () => {
          callCount++;
          if (callCount === 2) throw new Error('Simulated mel error');
          return { output: mockZeros([1, 1, N_MEL_FRAMES_PER_80MS, MEL_DIM]) };
        },
      });
      vi.mocked(ort.InferenceSession.create).mockImplementation(async (url: string | unknown) => {
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('melspectrogram')) return melSession;
        if (urlStr.includes('embedding')) return embeddingSession;
        return keywordSession;
      });

      const engine = createEngine();
      await engine.init();
      engine.start(vi.fn());

      // Frame 1: OK, Frame 2: error (silently caught), Frame 3: OK
      await engine.processFrame(makeFrame());
      await engine.processFrame(makeFrame());
      await engine.processFrame(makeFrame());

      // Should have attempted all 3, mel ran 3 times
      expect(callCount).toBe(3);
    });
  });
});
