import {
  EngineState,
  Keyword,
  VoicePageConfig,
  VoicePageEvent,
  VoicePageEventListener,
  IKwsEngine,
  IVadEngine,
  IAsrEngine,
  DomTarget,
  DEFAULT_CONFIG,
} from './types.js';
import { EventBus } from './event-bus.js';
import { buildDomIndex, DomIndexResult } from './dom-indexer.js';
import { resolveTarget, ResolutionResult } from './matcher.js';
import { determineAction, executeAction } from './action-executor.js';
import type { AudioPipeline } from './audio/audio-pipeline.js';

let requestCounter = 0;
function nextRequestId(): string {
  return `req-${++requestCounter}-${Date.now()}`;
}

export class VoicePageEngine {
  private state: EngineState = 'LISTENING_OFF';
  private config: VoicePageConfig;
  private eventBus: EventBus;
  private kwsEngine: IKwsEngine;
  private vadEngine: IVadEngine;
  private asrEngine: IAsrEngine;
  private audioPipeline: AudioPipeline | null = null;
  private unsubFrame: (() => void) | null = null;

  private currentRequestId: string | null = null;
  private currentIndex: DomIndexResult | null = null;
  private capturedAudio: Float32Array | null = null;
  private captureTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    kwsEngine: IKwsEngine,
    vadEngine: IVadEngine,
    asrEngine: IAsrEngine,
    config?: Partial<VoicePageConfig>,
    audioPipeline?: AudioPipeline,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = new EventBus();
    this.kwsEngine = kwsEngine;
    this.vadEngine = vadEngine;
    this.asrEngine = asrEngine;
    this.audioPipeline = audioPipeline ?? null;
  }

  // --- Public API ---

  async init(): Promise<void> {
    // Initialize audio pipeline first (requests mic permission)
    if (this.audioPipeline) {
      try {
        await this.audioPipeline.init();
      } catch (err) {
        this.emitError('MIC_NOT_AVAILABLE', 'Failed to initialize audio pipeline', err);
        throw err;
      }
    }

    try {
      await this.kwsEngine.init();
    } catch (err) {
      this.emitError('KWS_INIT_FAILED', 'Failed to initialize keyword spotter', err);
      throw err;
    }
    try {
      await this.vadEngine.init();
    } catch (err) {
      this.emitError('VAD_INIT_FAILED', 'Failed to initialize VAD', err);
      throw err;
    }
    try {
      await this.asrEngine.init();
    } catch (err) {
      this.emitError('ASR_INIT_FAILED', 'Failed to initialize ASR', err);
      throw err;
    }
  }

  getState(): EngineState {
    return this.state;
  }

  getConfig(): Readonly<VoicePageConfig> {
    return this.config;
  }

  on(listener: VoicePageEventListener): () => void {
    return this.eventBus.on(listener);
  }

  getEventHistory(): ReadonlyArray<VoicePageEvent> {
    return this.eventBus.getHistory();
  }

  getCurrentIndex(): DomIndexResult | null {
    return this.currentIndex;
  }

  startListening(): void {
    if (this.state !== 'LISTENING_OFF') return;
    this.setState('LISTENING_ON');
    this.emit({ type: 'ListeningChanged', ts: Date.now(), enabled: true });
    this.kwsEngine.start(this.handleKeyword.bind(this));

    // Wire audio pipeline frames to KWS engine
    if (this.audioPipeline && this.kwsEngine.processFrame) {
      this.audioPipeline.start();
      const kwsProcess = this.kwsEngine.processFrame.bind(this.kwsEngine);
      this.unsubFrame = this.audioPipeline.onFrame((frame) => {
        kwsProcess(frame);
      });
    }
  }

  stopListening(): void {
    this.cancelCurrentRequest('stop');
    this.kwsEngine.stop();
    this.unsubFrame?.();
    this.unsubFrame = null;
    this.audioPipeline?.stop();
    this.setState('LISTENING_OFF');
    this.emit({ type: 'ListeningChanged', ts: Date.now(), enabled: false });
  }

  cancel(): void {
    this.cancelCurrentRequest('cancel');
    if (this.state !== 'LISTENING_OFF') {
      this.setState('LISTENING_ON');
    }
  }

  /**
   * Manually trigger the open/click flow (for testing or keyboard trigger).
   */
  triggerOpen(): void {
    if (this.state !== 'LISTENING_ON') return;
    this.handleKeyword('open', 1.0);
  }

  /**
   * Simulate providing a transcript directly (for testing without audio).
   */
  async simulateTranscript(transcript: string): Promise<void> {
    if (this.state === 'LISTENING_OFF') return;

    const requestId = nextRequestId();
    this.currentRequestId = requestId;

    // Build index
    this.setState('RESOLVING_TARGET');
    this.currentIndex = buildDomIndex(this.config);
    this.emit({
      type: 'TargetIndexBuilt',
      ts: Date.now(),
      requestId,
      targetCount: this.currentIndex.targets.length,
      scope: this.currentIndex.scope,
    });

    this.emit({
      type: 'TranscriptReady',
      ts: Date.now(),
      requestId,
      transcript,
    });

    await this.resolveAndExecute(requestId, transcript);
  }

  /**
   * Select a specific target from disambiguation (called by UI).
   */
  async selectDisambiguationTarget(targetId: string): Promise<void> {
    if (!this.currentIndex) return;
    const target = this.currentIndex.targets.find((t) => t.id === targetId);
    if (!target) return;

    const requestId = this.currentRequestId ?? nextRequestId();
    this.setState('EXECUTING');
    await this.proposeAndExecute(requestId, target);
    this.returnToListening();
  }

  destroy(): void {
    this.cancelCurrentRequest('stop');
    this.unsubFrame?.();
    this.unsubFrame = null;
    this.kwsEngine.destroy();
    this.vadEngine.destroy();
    this.asrEngine.destroy();
    this.audioPipeline?.destroy();
    this.eventBus.clear();
  }

  // --- Internal ---

  private setState(next: EngineState): void {
    this.state = next;
  }

  private emit(event: VoicePageEvent): void {
    this.eventBus.emit(event);
  }

  private emitError(code: VoicePageEvent extends { code: infer C } ? C : string, message: string, details?: unknown): void {
    this.emit({
      type: 'EngineError',
      ts: Date.now(),
      requestId: this.currentRequestId ?? undefined,
      code: code as any,
      message,
      details,
    });
  }

  private handleKeyword(keyword: Keyword, confidence: number): void {
    this.emit({
      type: 'KeywordDetected',
      ts: Date.now(),
      keyword,
      confidence,
    });

    switch (keyword) {
      case 'open':
      case 'click':
        if (this.state === 'LISTENING_ON') {
          this.startCaptureFlow();
        }
        break;
      case 'stop':
        this.cancelCurrentRequest('stop');
        if (this.state !== 'LISTENING_OFF') {
          this.setState('LISTENING_ON');
        }
        break;
      case 'cancel':
        this.cancel();
        break;
      case 'help':
        // help is optional in v1, emit event for UI
        break;
    }
  }

  private startCaptureFlow(): void {
    const requestId = nextRequestId();
    this.currentRequestId = requestId;

    // Build DOM index at capture start
    this.currentIndex = buildDomIndex(this.config);

    this.setState('CAPTURING_TARGET');
    this.emit({ type: 'CaptureStarted', ts: Date.now(), requestId });
    this.emit({
      type: 'TargetIndexBuilt',
      ts: Date.now(),
      requestId,
      targetCount: this.currentIndex.targets.length,
      scope: this.currentIndex.scope,
    });

    // Start audio capture if pipeline is available
    if (this.audioPipeline) {
      this.audioPipeline.startCapture();
    }

    // Start VAD to detect speech boundaries
    this.vadEngine.startDetection(
      () => {
        // Speech started — nothing to do yet, keep capturing
      },
      () => {
        // Speech ended — stop capture and transcribe
        this.finishCapture(requestId, 'vad');
      },
    );

    // Wire audio frames to VAD during capture
    if (this.audioPipeline && this.vadEngine.processFrame) {
      const vadProcess = this.vadEngine.processFrame.bind(this.vadEngine);
      // The KWS frame listener is already running; add VAD frame listener
      // We store this on the capture timeout so we can clean it up
      const unsubVad = this.audioPipeline.onFrame((frame) => {
        vadProcess(frame);
      });
      // Store for cleanup
      (this as any)._unsubVadCapture = unsubVad;
    }

    // Set capture timeout
    this.captureTimeout = setTimeout(() => {
      this.finishCapture(requestId, 'timeout');
    }, this.config.captureTimeoutMs);
  }

  private finishCapture(requestId: string, reason: 'vad' | 'timeout' | 'stop' | 'cancel'): void {
    if (this.currentRequestId !== requestId) return;

    if (this.captureTimeout) {
      clearTimeout(this.captureTimeout);
      this.captureTimeout = null;
    }
    this.vadEngine.stopDetection();

    // Clean up VAD frame listener
    const unsubVad = (this as any)._unsubVadCapture as (() => void) | undefined;
    unsubVad?.();
    (this as any)._unsubVadCapture = undefined;

    // Grab captured audio from pipeline
    if (this.audioPipeline) {
      this.capturedAudio = this.audioPipeline.stopCapture();
    }

    this.emit({ type: 'CaptureEnded', ts: Date.now(), requestId, reason });

    if (reason === 'stop' || reason === 'cancel') {
      this.returnToListening();
      return;
    }

    this.startTranscription(requestId);
  }

  private async startTranscription(requestId: string): Promise<void> {
    if (this.currentRequestId !== requestId) return;
    this.setState('TRANSCRIBING');
    this.emit({ type: 'TranscriptionStarted', ts: Date.now(), requestId });

    try {
      const audio = this.capturedAudio ?? new Float32Array(0);
      const transcript = await this.asrEngine.transcribe(audio);

      if (this.currentRequestId !== requestId) return;

      this.emit({ type: 'TranscriptReady', ts: Date.now(), requestId, transcript });

      if (!transcript.trim()) {
        this.emitError('NO_SPEECH_DETECTED', 'No speech detected in captured audio');
        this.setState('ERROR');
        this.returnToListening();
        return;
      }

      await this.resolveAndExecute(requestId, transcript);
    } catch (err) {
      this.emitError('ASR_FAILED', 'ASR transcription failed', err);
      this.setState('ERROR');
      this.returnToListening();
    }
  }

  private async resolveAndExecute(requestId: string, transcript: string): Promise<void> {
    if (this.currentRequestId !== requestId) return;

    this.setState('RESOLVING_TARGET');
    const targets = this.currentIndex?.targets ?? [];
    const result = resolveTarget(transcript, targets, this.config);

    switch (result.status) {
      case 'unique': {
        const match = result.matches[0];
        this.emit({
          type: 'TargetResolved',
          ts: Date.now(),
          requestId,
          targetId: match.target.id,
          label: match.target.normalizedLabel,
          match: match.type,
        });
        this.setState('EXECUTING');
        await this.proposeAndExecute(requestId, match.target);
        this.returnToListening();
        break;
      }
      case 'ambiguous':
        this.emit({
          type: 'TargetResolutionFailed',
          ts: Date.now(),
          requestId,
          reason: 'ambiguous',
          details: {
            candidates: result.matches.map((m) => ({
              targetId: m.target.id,
              label: m.target.normalizedLabel,
              score: m.score,
            })),
          },
        });
        this.setState('ERROR');
        // Stay in error — UI may show disambiguation modal
        break;
      case 'no_match':
        this.emit({
          type: 'TargetResolutionFailed',
          ts: Date.now(),
          requestId,
          reason: 'no_match',
        });
        this.setState('ERROR');
        this.returnToListening();
        break;
      case 'misconfiguration':
        this.emit({
          type: 'TargetResolutionFailed',
          ts: Date.now(),
          requestId,
          reason: 'misconfiguration',
          details: result.details,
        });
        this.setState('ERROR');
        this.returnToListening();
        break;
    }
  }

  private async proposeAndExecute(requestId: string, target: DomTarget): Promise<void> {
    const action = determineAction(target);

    this.emit({
      type: 'ActionProposed',
      ts: Date.now(),
      requestId,
      action,
      targetId: target.id,
      risk: target.risk,
    });

    // Highlight delay (UI subscribes and renders highlight)
    await this.delay(this.config.highlightMs);

    if (this.currentRequestId !== requestId) return;

    const result = executeAction(target, action);

    this.emit({
      type: 'ActionExecuted',
      ts: Date.now(),
      requestId,
      action,
      targetId: target.id,
      ok: result.ok,
      error: result.error,
    });

    if (!result.ok) {
      this.emitError('EXECUTION_FAILED', result.error ?? 'Action execution failed');
    }
  }

  private cancelCurrentRequest(reason: 'stop' | 'cancel'): void {
    if (this.currentRequestId && (this.state === 'CAPTURING_TARGET' || this.state === 'TRANSCRIBING')) {
      this.finishCapture(this.currentRequestId, reason);
    }
    if (this.captureTimeout) {
      clearTimeout(this.captureTimeout);
      this.captureTimeout = null;
    }
    this.vadEngine.stopDetection();
    this.currentRequestId = null;
    this.capturedAudio = null;
  }

  private returnToListening(): void {
    this.currentRequestId = null;
    this.capturedAudio = null;
    if (this.state !== 'LISTENING_OFF') {
      this.setState('LISTENING_ON');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
