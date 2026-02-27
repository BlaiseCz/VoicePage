/// <reference types="vitest/globals" />
/**
 * Shared mock utilities for onnxruntime-web in unit tests.
 *
 * Creates mock InferenceSession objects that return configurable tensor outputs.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';

export interface MockTensorDef {
  data: Float32Array | BigInt64Array;
  dims: readonly number[];
}

export type RunHandler = (
  feeds: Record<string, Tensor>,
) => Record<string, MockTensorDef>;

/**
 * Create a mock InferenceSession with configurable input/output names and a run handler.
 */
export function createMockSession(opts: {
  inputNames: string[];
  outputNames: string[];
  onRun: RunHandler;
}): InferenceSession {
  const session = {
    inputNames: opts.inputNames,
    outputNames: opts.outputNames,
    run: vi.fn(async (feeds: Record<string, Tensor>) => {
      const raw = opts.onRun(feeds);
      const result: Record<string, Tensor> = {};
      for (const [name, def] of Object.entries(raw)) {
        result[name] = {
          data: def.data,
          dims: def.dims,
          type: def.data instanceof BigInt64Array ? 'int64' : 'float32',
          size: def.data.length,
        } as unknown as Tensor;
      }
      return result;
    }),
    release: vi.fn(),
  } as unknown as InferenceSession;
  return session;
}

/**
 * Create a simple Float32 mock tensor definition.
 */
export function mockFloat32(data: number[], dims: number[]): MockTensorDef {
  return { data: new Float32Array(data), dims };
}

/**
 * Create a zero-filled Float32 mock tensor definition.
 */
export function mockZeros(dims: number[]): MockTensorDef {
  const size = dims.reduce((a, b) => a * b, 1);
  return { data: new Float32Array(size), dims };
}
