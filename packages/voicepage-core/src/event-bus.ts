import { VoicePageEvent, VoicePageEventListener } from './types.js';

export class EventBus {
  private listeners: Set<VoicePageEventListener> = new Set();
  private history: VoicePageEvent[] = [];

  on(listener: VoicePageEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: VoicePageEvent): void {
    this.history.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // UI listeners must not crash the engine
      }
    }
  }

  getHistory(): ReadonlyArray<VoicePageEvent> {
    return this.history;
  }

  clear(): void {
    this.listeners.clear();
    this.history = [];
  }
}
