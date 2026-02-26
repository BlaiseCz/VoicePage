import { IKwsEngine, Keyword } from '../types.js';

/**
 * Stub KWS engine for development/testing.
 * Does not perform real keyword spotting — keywords are triggered externally.
 */
export class StubKwsEngine implements IKwsEngine {
  private callback: ((keyword: Keyword, confidence: number) => void) | null = null;

  async init(): Promise<void> {
    // No-op
  }

  start(onKeyword: (keyword: Keyword, confidence: number) => void): void {
    this.callback = onKeyword;
  }

  stop(): void {
    this.callback = null;
  }

  destroy(): void {
    this.callback = null;
  }

  /** Manually inject a keyword detection (for testing / demo). */
  injectKeyword(keyword: Keyword, confidence: number = 1.0): void {
    this.callback?.(keyword, confidence);
  }
}
