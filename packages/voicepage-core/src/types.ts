// --- State Machine ---

export type EngineState =
  | 'LISTENING_OFF'
  | 'LISTENING_ON'
  | 'CAPTURING_TARGET'
  | 'TRANSCRIBING'
  | 'RESOLVING_TARGET'
  | 'AWAITING_CONFIRMATION'
  | 'EXECUTING'
  | 'ERROR';

// --- Keywords ---

export type Keyword = 'open' | 'click' | 'stop' | 'cancel' | 'help';

// --- Collision Policy ---

export type CollisionPolicy = 'disambiguate' | 'error';

// --- Match Type ---

export type MatchType = 'exact' | 'fuzzy';

// --- Action Type ---

export type ActionType = 'click' | 'focus' | 'activate' | 'scroll_focus';

// --- Events ---

export interface VoicePageEventBase {
  type: string;
  ts: number;
  requestId?: string;
}

export interface ListeningChanged extends VoicePageEventBase {
  type: 'ListeningChanged';
  enabled: boolean;
}

export interface KeywordDetected extends VoicePageEventBase {
  type: 'KeywordDetected';
  keyword: Keyword;
  confidence?: number;
}

export interface CaptureStarted extends VoicePageEventBase {
  type: 'CaptureStarted';
  requestId: string;
}

export interface CaptureEnded extends VoicePageEventBase {
  type: 'CaptureEnded';
  requestId: string;
  reason: 'vad' | 'timeout' | 'stop' | 'cancel';
}

export interface TranscriptionStarted extends VoicePageEventBase {
  type: 'TranscriptionStarted';
  requestId: string;
}

export interface TranscriptReady extends VoicePageEventBase {
  type: 'TranscriptReady';
  requestId: string;
  transcript: string;
}

export interface TargetIndexBuilt extends VoicePageEventBase {
  type: 'TargetIndexBuilt';
  requestId: string;
  targetCount: number;
  scope: 'page' | 'modal';
}

export interface TargetResolutionFailed extends VoicePageEventBase {
  type: 'TargetResolutionFailed';
  requestId: string;
  reason: 'no_match' | 'ambiguous' | 'misconfiguration';
  details?: unknown;
}

export interface TargetResolved extends VoicePageEventBase {
  type: 'TargetResolved';
  requestId: string;
  targetId: string;
  label: string;
  match: MatchType;
}

export interface ActionProposed extends VoicePageEventBase {
  type: 'ActionProposed';
  requestId: string;
  action: ActionType;
  targetId: string;
  risk?: 'high';
}

export interface ConfirmationRequired extends VoicePageEventBase {
  type: 'ConfirmationRequired';
  requestId: string;
  action: ActionType;
  targetId: string;
  label: string;
}

export interface ActionExecuted extends VoicePageEventBase {
  type: 'ActionExecuted';
  requestId: string;
  action: string;
  targetId: string;
  ok: boolean;
  error?: string;
}

export interface EngineError extends VoicePageEventBase {
  type: 'EngineError';
  requestId?: string;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type VoicePageEvent =
  | ListeningChanged
  | KeywordDetected
  | CaptureStarted
  | CaptureEnded
  | TranscriptionStarted
  | TranscriptReady
  | TargetIndexBuilt
  | TargetResolutionFailed
  | TargetResolved
  | ActionProposed
  | ConfirmationRequired
  | ActionExecuted
  | EngineError;

// --- Error Codes ---

export type ErrorCode =
  | 'MIC_PERMISSION_DENIED'
  | 'MIC_NOT_AVAILABLE'
  | 'KWS_INIT_FAILED'
  | 'VAD_INIT_FAILED'
  | 'ASR_INIT_FAILED'
  | 'ASR_FAILED'
  | 'NO_SPEECH_DETECTED'
  | 'NO_MATCH'
  | 'AMBIGUOUS_MATCH'
  | 'MISCONFIG_DUPLICATE_LABELS'
  | 'MISCONFIG_NO_ADDRESSABLE_TARGETS'
  | 'EXECUTION_FAILED';

// --- Configuration ---

export interface VoicePageConfig {
  collisionPolicy: CollisionPolicy;
  fuzzyThreshold: number;
  fuzzyMargin: number;
  kwsThreshold: number;
  captureTimeoutMs: number;
  highlightMs: number;
  vadSilenceMs: number;
  globalDenySelectors: string[];
}

export const DEFAULT_CONFIG: VoicePageConfig = {
  collisionPolicy: 'disambiguate',
  fuzzyThreshold: 0.7,
  fuzzyMargin: 0.15,
  kwsThreshold: 0.5,
  captureTimeoutMs: 5000,
  highlightMs: 300,
  vadSilenceMs: 1000,
  globalDenySelectors: [],
};

// --- DOM Target ---

export interface DomTarget {
  id: string;
  element: Element;
  rawLabel: string;
  normalizedLabel: string;
  synonyms: string[];
  risk?: 'high';
}

// --- Pluggable Interfaces ---

export interface IKwsEngine {
  init(): Promise<void>;
  start(onKeyword: (keyword: string, confidence: number) => void): void;
  stop(): void;
  destroy(): void;
  /** Feed a single 80ms PCM frame (1280 samples, Float32, 16kHz). Optional — real engines implement this. */
  processFrame?(frame: Float32Array): Promise<void>;
}

export interface IVadEngine {
  init(): Promise<void>;
  startDetection(
    onSpeechStart: () => void,
    onSpeechEnd: () => void,
  ): void;
  stopDetection(): void;
  destroy(): void;
  /** Feed a single 80ms PCM frame (1280 samples, Float32, 16kHz). Optional — real engines implement this. */
  processFrame?(frame: Float32Array): Promise<void>;
}

export interface IAsrEngine {
  init(): Promise<void>;
  transcribe(audio: Float32Array): Promise<string>;
  destroy(): void;
}

// --- Event Listener ---

export type VoicePageEventListener = (event: VoicePageEvent) => void;
