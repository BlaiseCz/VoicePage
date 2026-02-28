/// <reference types="vitest/globals" />

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../event-bus.js';
import type { VoicePageEvent } from '../types.js';

function makeEvent(type: string): VoicePageEvent {
  return { type, ts: Date.now() } as VoicePageEvent;
}

describe('EventBus', () => {
  describe('on / emit', () => {
    it('should deliver events to registered listeners', () => {
      const bus = new EventBus();
      const listener = vi.fn();
      bus.on(listener);

      const event = makeEvent('ListeningChanged');
      bus.emit(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should deliver to multiple listeners', () => {
      const bus = new EventBus();
      const a = vi.fn();
      const b = vi.fn();
      bus.on(a);
      bus.on(b);

      bus.emit(makeEvent('ListeningChanged'));

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('should not deliver to unsubscribed listeners', () => {
      const bus = new EventBus();
      const listener = vi.fn();
      const unsub = bus.on(listener);

      unsub();
      bus.emit(makeEvent('ListeningChanged'));

      expect(listener).not.toHaveBeenCalled();
    });

    it('should return a working unsubscribe function', () => {
      const bus = new EventBus();
      const listener = vi.fn();
      const unsub = bus.on(listener);

      bus.emit(makeEvent('ListeningChanged'));
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      bus.emit(makeEvent('KeywordDetected'));
      expect(listener).toHaveBeenCalledTimes(1); // no additional calls
    });
  });

  describe('error isolation', () => {
    it('should not crash when a listener throws', () => {
      const bus = new EventBus();
      const bad = vi.fn(() => {
        throw new Error('listener crash');
      });
      const good = vi.fn();
      bus.on(bad);
      bus.on(good);

      expect(() => bus.emit(makeEvent('ListeningChanged'))).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  describe('history', () => {
    it('should record all emitted events', () => {
      const bus = new EventBus();
      bus.emit(makeEvent('ListeningChanged'));
      bus.emit(makeEvent('KeywordDetected'));

      const history = bus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].type).toBe('ListeningChanged');
      expect(history[1].type).toBe('KeywordDetected');
    });

    it('should return readonly history', () => {
      const bus = new EventBus();
      bus.emit(makeEvent('ListeningChanged'));

      const history = bus.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all listeners and clear history', () => {
      const bus = new EventBus();
      const listener = vi.fn();
      bus.on(listener);
      bus.emit(makeEvent('ListeningChanged'));

      bus.clear();

      expect(bus.getHistory()).toHaveLength(0);

      bus.emit(makeEvent('KeywordDetected'));
      expect(listener).toHaveBeenCalledTimes(1); // only the first emit
    });
  });
});
