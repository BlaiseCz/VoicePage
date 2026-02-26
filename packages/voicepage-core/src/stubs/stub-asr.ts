import { IAsrEngine } from '../types.js';

/**
 * Stub ASR engine that returns a pre-configured transcript.
 * Useful for testing the full pipeline without real audio.
 */
export class StubAsrEngine implements IAsrEngine {
  private nextTranscript: string = '';

  async init(): Promise<void> {
    // No-op
  }

  async transcribe(_audio: Float32Array): Promise<string> {
    return this.nextTranscript;
  }

  destroy(): void {
    // No-op
  }

  /** Set the transcript that will be returned by the next transcribe call. */
  setNextTranscript(transcript: string): void {
    this.nextTranscript = transcript;
  }
}
