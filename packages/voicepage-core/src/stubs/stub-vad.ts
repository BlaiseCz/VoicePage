import { IVadEngine } from '../types.js';

/**
 * Stub VAD engine. Simulates speech detection by auto-ending after a delay.
 */
export class StubVadEngine implements IVadEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delayMs: number;

  constructor(delayMs: number = 2000) {
    this.delayMs = delayMs;
  }

  async init(): Promise<void> {
    // No-op
  }

  startDetection(onSpeechStart: () => void, onSpeechEnd: () => void): void {
    // Simulate speech start immediately
    onSpeechStart();
    // Simulate speech end after delay
    this.timer = setTimeout(() => {
      onSpeechEnd();
    }, this.delayMs);
  }

  stopDetection(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.stopDetection();
  }
}
