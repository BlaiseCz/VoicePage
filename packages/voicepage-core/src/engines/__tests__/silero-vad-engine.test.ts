/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSession } from './ort-mock.js';
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

import { SileroVadEngine } from '../silero-vad-engine.js';
import * as ort from 'onnxruntime-web';

const VAD_CHUNK_SIZE = 512;
const FRAME_SIZE = 1280; // 80ms at 16kHz

describe('SileroVadEngine', () => {
  let vadSession: InferenceSession;
  let chunkProbabilities: number[];
  let chunkIndex: number;

  function makeVadSession(probs?: number[]) {
    chunkProbabilities = probs ?? [0.0];
    chunkIndex = 0;
    return createMockSession({
      inputNames: ['input', 'state', 'sr'],
      outputNames: ['output', 'stateN'],
      onRun: () => {
        const prob = chunkProbabilities[Math.min(chunkIndex, chunkProbabilities.length - 1)];
        chunkIndex++;
        return {
          output: { data: new Float32Array([prob]), dims: [1, 1] },
          stateN: { data: new Float32Array(2 * 1 * 128), dims: [2, 1, 128] },
        };
      },
    });
  }

  beforeEach(() => {
    vadSession = makeVadSession();
    vi.mocked(ort.InferenceSession.create).mockReset().mockResolvedValue(vadSession);
  });

  function createEngine(opts?: {
    startThreshold?: number;
    endThreshold?: number;
    silenceDurationMs?: number;
    minSpeechDurationMs?: number;
  }) {
    return new SileroVadEngine({
      modelUrl: '/models/vad/silero_vad.onnx',
      startThreshold: opts?.startThreshold ?? 0.5,
      endThreshold: opts?.endThreshold ?? 0.35,
      silenceDurationMs: opts?.silenceDurationMs ?? 100, // Short for testing
      minSpeechDurationMs: opts?.minSpeechDurationMs ?? 50, // Short for testing
    });
  }

  function makeFrame(): Float32Array {
    return new Float32Array(FRAME_SIZE);
  }

  // --- Lifecycle tests ---

  describe('lifecycle', () => {
    it('should load model on init', async () => {
      const engine = createEngine();
      await engine.init();

      expect(ort.InferenceSession.create).toHaveBeenCalledWith(
        '/models/vad/silero_vad.onnx',
        expect.objectContaining({ executionProviders: ['wasm'] }),
      );
    });

    it('should release session on destroy', async () => {
      const engine = createEngine();
      await engine.init();
      engine.destroy();

      expect(vadSession.release).toHaveBeenCalled();
    });

    it('should not process frames before startDetection', async () => {
      const engine = createEngine();
      await engine.init();

      await engine.processFrame(makeFrame());
      expect(vadSession.run).not.toHaveBeenCalled();
    });

    it('should not process frames after stopDetection', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startDetection(vi.fn(), vi.fn());
      engine.stopDetection();

      await engine.processFrame(makeFrame());
      expect(vadSession.run).not.toHaveBeenCalled();
    });
  });

  // --- Chunk splitting ---

  describe('chunk splitting', () => {
    it('should split 80ms frames into 512-sample VAD chunks', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startDetection(vi.fn(), vi.fn());

      // 1280 samples / 512 = 2 complete chunks + 256 remainder
      await engine.processFrame(makeFrame());
      expect(vadSession.run).toHaveBeenCalledTimes(2);
    });

    it('should carry over remainder to next frame', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startDetection(vi.fn(), vi.fn());

      // Frame 1: 1280 → 2 chunks (1024 used), 256 leftover
      await engine.processFrame(makeFrame());
      expect(vadSession.run).toHaveBeenCalledTimes(2);

      // Frame 2: 256 + 1280 = 1536 → 3 chunks (1536 used), 0 leftover
      await engine.processFrame(makeFrame());
      expect(vadSession.run).toHaveBeenCalledTimes(5); // 2 + 3
    });
  });

  // --- Speech detection ---

  describe('speech detection', () => {
    it('should fire onSpeechStart when probability exceeds startThreshold', async () => {
      vadSession = makeVadSession([0.8]); // All chunks above threshold
      vi.mocked(ort.InferenceSession.create).mockResolvedValue(vadSession);

      const engine = createEngine({ startThreshold: 0.5 });
      await engine.init();
      const onStart = vi.fn();
      const onEnd = vi.fn();
      engine.startDetection(onStart, onEnd);

      await engine.processFrame(makeFrame());

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('should not fire onSpeechStart for sub-threshold probabilities', async () => {
      vadSession = makeVadSession([0.3]); // Below threshold
      vi.mocked(ort.InferenceSession.create).mockResolvedValue(vadSession);

      const engine = createEngine({ startThreshold: 0.5 });
      await engine.init();
      const onStart = vi.fn();
      engine.startDetection(onStart, vi.fn());

      await engine.processFrame(makeFrame());

      expect(onStart).not.toHaveBeenCalled();
    });

    it('should fire onSpeechEnd after silence duration is met', async () => {
      // First chunks: high probability (speech), then low probability (silence)
      const probs = [0.8, 0.8, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
      vadSession = makeVadSession(probs);
      vi.mocked(ort.InferenceSession.create).mockResolvedValue(vadSession);

      const engine = createEngine({
        startThreshold: 0.5,
        endThreshold: 0.35,
        silenceDurationMs: 0, // Trigger immediately on silence
        minSpeechDurationMs: 0,
      });
      await engine.init();
      const onStart = vi.fn();
      const onEnd = vi.fn();
      engine.startDetection(onStart, onEnd);

      // Process multiple frames to go through speech → silence transition
      for (let i = 0; i < 5; i++) {
        await engine.processFrame(makeFrame());
      }

      expect(onStart).toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalled();
    });

    it('should not fire onSpeechEnd if speech is maintained above endThreshold', async () => {
      // All chunks above endThreshold
      vadSession = makeVadSession([0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.4, 0.4]);
      vi.mocked(ort.InferenceSession.create).mockResolvedValue(vadSession);

      const engine = createEngine({
        startThreshold: 0.5,
        endThreshold: 0.35,
        silenceDurationMs: 100,
        minSpeechDurationMs: 0,
      });
      await engine.init();
      const onEnd = vi.fn();
      engine.startDetection(vi.fn(), onEnd);

      for (let i = 0; i < 3; i++) {
        await engine.processFrame(makeFrame());
      }

      expect(onEnd).not.toHaveBeenCalled();
    });
  });

  // --- State management ---

  describe('state management', () => {
    it('should pass state tensor to model and update from output', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startDetection(vi.fn(), vi.fn());

      await engine.processFrame(makeFrame());

      // Verify state was passed in feeds
      const calls = vi.mocked(vadSession.run).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0][0] as Record<string, unknown>;
      expect(firstCall).toHaveProperty('state');
      expect(firstCall).toHaveProperty('sr');
      expect(firstCall).toHaveProperty('input');
    });

    it('should reset state on startDetection', async () => {
      const engine = createEngine();
      await engine.init();

      // Start, process, stop
      engine.startDetection(vi.fn(), vi.fn());
      await engine.processFrame(makeFrame());
      engine.stopDetection();

      // Start again — state should be fresh (no leakage from prior session)
      engine.startDetection(vi.fn(), vi.fn());
      await engine.processFrame(makeFrame());

      // The engine should work correctly after restart
      expect(vadSession.run).toHaveBeenCalled();
    });
  });

  // --- Error resilience ---

  describe('error resilience', () => {
    it('should continue processing after a chunk error', async () => {
      let callCount = 0;
      vadSession = createMockSession({
        inputNames: ['input', 'state', 'sr'],
        outputNames: ['output', 'stateN'],
        onRun: () => {
          callCount++;
          if (callCount === 1) throw new Error('Simulated error');
          return {
            output: { data: new Float32Array([0.1]), dims: [1, 1] },
            stateN: { data: new Float32Array(2 * 1 * 128), dims: [2, 1, 128] },
          };
        },
      });
      vi.mocked(ort.InferenceSession.create).mockResolvedValue(vadSession);

      const engine = createEngine();
      await engine.init();
      engine.startDetection(vi.fn(), vi.fn());

      // First frame: 2 chunks, first errors, second succeeds
      await engine.processFrame(makeFrame());

      // Second frame should still work
      await engine.processFrame(makeFrame());
      expect(callCount).toBe(5); // 2 + 3 chunks total
    });
  });
});
