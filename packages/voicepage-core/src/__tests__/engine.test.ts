/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DOM-dependent modules before importing the engine
vi.mock('../dom-indexer.js', () => ({
  buildDomIndex: vi.fn(() => ({
    targets: [
      { id: 'vp-target-1', element: {}, rawLabel: 'Submit', normalizedLabel: 'submit', aliases: [], rect: {} },
      { id: 'vp-target-2', element: {}, rawLabel: 'Cancel', normalizedLabel: 'cancel', aliases: [], rect: {} },
    ],
    scope: 'page' as const,
  })),
}));

vi.mock('../matcher.js', () => ({
  resolveTarget: vi.fn(() => ({
    status: 'matched' as const,
    target: { id: 'vp-target-1', element: {}, rawLabel: 'Submit', normalizedLabel: 'submit', aliases: [], rect: {} },
    match: 'exact' as const,
  })),
}));

vi.mock('../action-executor.js', () => ({
  determineAction: vi.fn(() => 'click' as const),
  executeAction: vi.fn(() => ({ ok: true })),
}));

import { VoicePageEngine } from '../engine.js';
import type {
  IKwsEngine,
  IVadEngine,
  IAsrEngine,
  Keyword,
  VoicePageEvent,
} from '../types.js';

// --- Stub engines ---

function createStubKws(): IKwsEngine & {
  _onKeyword: ((kw: Keyword, conf: number) => void) | null;
  _processFrameCalls: Float32Array[];
} {
  const stub = {
    _onKeyword: null as ((kw: Keyword, conf: number) => void) | null,
    _processFrameCalls: [] as Float32Array[],
    init: vi.fn(async () => {}),
    start: vi.fn((cb: (kw: Keyword, conf: number) => void) => {
      stub._onKeyword = cb;
    }),
    stop: vi.fn(() => {
      stub._onKeyword = null;
    }),
    destroy: vi.fn(),
    processFrame: vi.fn(async (frame: Float32Array) => {
      stub._processFrameCalls.push(frame);
    }),
  };
  return stub;
}

function createStubVad(): IVadEngine & {
  _onSpeechStart: (() => void) | null;
  _onSpeechEnd: (() => void) | null;
} {
  const stub = {
    _onSpeechStart: null as (() => void) | null,
    _onSpeechEnd: null as (() => void) | null,
    init: vi.fn(async () => {}),
    startDetection: vi.fn((onStart: () => void, onEnd: () => void) => {
      stub._onSpeechStart = onStart;
      stub._onSpeechEnd = onEnd;
    }),
    stopDetection: vi.fn(() => {
      stub._onSpeechStart = null;
      stub._onSpeechEnd = null;
    }),
    destroy: vi.fn(),
    processFrame: vi.fn(async () => {}),
  };
  return stub;
}

function createStubAsr(transcript = 'hello'): IAsrEngine {
  return {
    init: vi.fn(async () => {}),
    transcribe: vi.fn(async () => transcript),
    destroy: vi.fn(),
  };
}

// --- Helpers ---

function collectEvents(engine: VoicePageEngine): VoicePageEvent[] {
  const events: VoicePageEvent[] = [];
  engine.on((e) => events.push(e));
  return events;
}

describe('VoicePageEngine', () => {
  let kws: ReturnType<typeof createStubKws>;
  let vad: ReturnType<typeof createStubVad>;
  let asr: ReturnType<typeof createStubAsr>;

  beforeEach(() => {
    kws = createStubKws();
    vad = createStubVad();
    asr = createStubAsr();
  });

  function createEngine(config?: Record<string, unknown>) {
    return new VoicePageEngine(kws, vad, asr, config as any);
  }

  // --- Initialization ---

  describe('init', () => {
    it('should initialize all engines', async () => {
      const engine = createEngine();
      await engine.init();

      expect(kws.init).toHaveBeenCalledTimes(1);
      expect(vad.init).toHaveBeenCalledTimes(1);
      expect(asr.init).toHaveBeenCalledTimes(1);
    });

    it('should throw and emit error if KWS init fails', async () => {
      kws.init.mockRejectedValueOnce(new Error('KWS failed'));
      const engine = createEngine();
      const events = collectEvents(engine);

      await expect(engine.init()).rejects.toThrow('KWS failed');
      expect(events.some((e) => e.type === 'EngineError')).toBe(true);
    });

    it('should throw and emit error if VAD init fails', async () => {
      vad.init.mockRejectedValueOnce(new Error('VAD failed'));
      const engine = createEngine();
      const events = collectEvents(engine);

      await expect(engine.init()).rejects.toThrow('VAD failed');
      expect(events.some((e) => e.type === 'EngineError')).toBe(true);
    });

    it('should throw and emit error if ASR init fails', async () => {
      asr.init.mockRejectedValueOnce(new Error('ASR failed'));
      const engine = createEngine();
      const events = collectEvents(engine);

      await expect(engine.init()).rejects.toThrow('ASR failed');
      expect(events.some((e) => e.type === 'EngineError')).toBe(true);
    });
  });

  // --- State machine ---

  describe('state machine', () => {
    it('should start in LISTENING_OFF', () => {
      const engine = createEngine();
      expect(engine.getState()).toBe('LISTENING_OFF');
    });

    it('should transition to LISTENING_ON when startListening is called', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();
      expect(engine.getState()).toBe('LISTENING_ON');
    });

    it('should transition back to LISTENING_OFF when stopListening is called', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();
      engine.stopListening();
      expect(engine.getState()).toBe('LISTENING_OFF');
    });

    it('should not start listening if already listening', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();
      engine.startListening(); // second call should be ignored
      expect(kws.start).toHaveBeenCalledTimes(1);
    });
  });

  // --- Event emission ---

  describe('events', () => {
    it('should emit ListeningChanged on start/stop', async () => {
      const engine = createEngine();
      await engine.init();
      const events = collectEvents(engine);

      engine.startListening();
      engine.stopListening();

      const listeningEvents = events.filter((e) => e.type === 'ListeningChanged');
      expect(listeningEvents).toHaveLength(2);
      expect((listeningEvents[0] as any).enabled).toBe(true);
      expect((listeningEvents[1] as any).enabled).toBe(false);
    });

    it('should emit KeywordDetected when KWS fires a keyword', async () => {
      const engine = createEngine();
      await engine.init();
      const events = collectEvents(engine);

      engine.startListening();
      // Simulate KWS detecting "help" (doesn't trigger capture flow)
      kws._onKeyword?.('help', 0.95);

      const kwEvents = events.filter((e) => e.type === 'KeywordDetected');
      expect(kwEvents).toHaveLength(1);
      expect((kwEvents[0] as any).keyword).toBe('help');
    });

    it('should record events in history', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();

      const history = engine.getEventHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].type).toBe('ListeningChanged');
    });
  });

  // --- KWS engine wiring ---

  describe('KWS wiring', () => {
    it('should start KWS engine on startListening', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();

      expect(kws.start).toHaveBeenCalledTimes(1);
    });

    it('should stop KWS engine on stopListening', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();
      engine.stopListening();

      expect(kws.stop).toHaveBeenCalledTimes(1);
    });

    it('should handle "open" keyword by starting capture flow', async () => {
      const engine = createEngine();
      await engine.init();
      const events = collectEvents(engine);

      engine.startListening();
      kws._onKeyword?.('open', 0.9);

      expect(engine.getState()).toBe('CAPTURING_TARGET');
      expect(events.some((e) => e.type === 'CaptureStarted')).toBe(true);
    });

    it('should handle "stop" keyword by canceling current request', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();

      // Start capture
      kws._onKeyword?.('open', 0.9);
      expect(engine.getState()).toBe('CAPTURING_TARGET');

      // Cancel with stop
      kws._onKeyword?.('stop', 0.9);
      expect(engine.getState()).toBe('LISTENING_ON');
    });

    it('should handle "cancel" keyword', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();

      kws._onKeyword?.('open', 0.9);
      kws._onKeyword?.('cancel', 0.9);
      expect(engine.getState()).toBe('LISTENING_ON');
    });
  });

  // --- VAD wiring ---

  describe('VAD wiring', () => {
    it('should start VAD detection when capture flow begins', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();

      kws._onKeyword?.('open', 0.9);

      expect(vad.startDetection).toHaveBeenCalledTimes(1);
    });

    it('should stop VAD detection when capture is canceled', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();

      kws._onKeyword?.('open', 0.9);
      kws._onKeyword?.('stop', 0.9);

      expect(vad.stopDetection).toHaveBeenCalled();
    });
  });

  // --- Cleanup ---

  describe('destroy', () => {
    it('should destroy all engines', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();
      engine.destroy();

      expect(kws.destroy).toHaveBeenCalled();
      expect(vad.destroy).toHaveBeenCalled();
      expect(asr.destroy).toHaveBeenCalled();
    });
  });

  // --- triggerOpen ---

  describe('triggerOpen', () => {
    it('should start capture flow when in LISTENING_ON state', async () => {
      const engine = createEngine();
      await engine.init();
      engine.startListening();
      const events = collectEvents(engine);

      engine.triggerOpen();

      expect(engine.getState()).toBe('CAPTURING_TARGET');
      expect(events.some((e) => e.type === 'KeywordDetected')).toBe(true);
    });

    it('should do nothing when in LISTENING_OFF state', async () => {
      const engine = createEngine();
      await engine.init();
      const events = collectEvents(engine);

      engine.triggerOpen();

      expect(engine.getState()).toBe('LISTENING_OFF');
      expect(events).toHaveLength(0);
    });
  });

  // --- Config ---

  describe('config', () => {
    it('should expose default config', () => {
      const engine = createEngine();
      const config = engine.getConfig();
      expect(config.collisionPolicy).toBe('disambiguate');
      expect(config.captureTimeoutMs).toBe(5000);
    });

    it('should merge provided config with defaults', () => {
      const engine = createEngine({ captureTimeoutMs: 3000 });
      const config = engine.getConfig();
      expect(config.captureTimeoutMs).toBe(3000);
      expect(config.collisionPolicy).toBe('disambiguate'); // default preserved
    });
  });
});
