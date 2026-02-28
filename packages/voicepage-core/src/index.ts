export { VoicePageEngine } from './engine.js';
export { EventBus } from './event-bus.js';
export { buildDomIndex } from './dom-indexer.js';
export type { DomIndexResult } from './dom-indexer.js';
export { resolveTarget } from './matcher.js';
export type { MatchResult, ResolutionResult } from './matcher.js';
export { normalizeLabel } from './normalize.js';
export { determineAction, executeAction } from './action-executor.js';

// Audio pipeline
export { AudioPipeline } from './audio/index.js';
export type { PcmFrameCallback } from './audio/index.js';

// Real engines
export { OwwKwsEngine } from './engines/index.js';
export type { OwwKwsEngineOptions } from './engines/index.js';
export { SileroVadEngine } from './engines/index.js';
export type { SileroVadEngineOptions } from './engines/index.js';
export { WhisperAsrEngine } from './engines/index.js';
export type { WhisperAsrEngineOptions } from './engines/index.js';

// Stubs for development/testing
export { StubKwsEngine } from './stubs/stub-kws.js';
export { StubVadEngine } from './stubs/stub-vad.js';
export { StubAsrEngine } from './stubs/stub-asr.js';

// Types
export type {
  EngineState,
  Keyword,
  CollisionPolicy,
  MatchType,
  ActionType,
  VoicePageEventBase,
  ListeningChanged,
  KeywordDetected,
  CaptureStarted,
  CaptureEnded,
  TranscriptionStarted,
  TranscriptReady,
  TargetIndexBuilt,
  TargetResolutionFailed,
  TargetResolved,
  ActionProposed,
  ConfirmationRequired,
  ActionExecuted,
  EngineError,
  VoicePageEvent,
  ErrorCode,
  VoicePageConfig,
  DomTarget,
  IKwsEngine,
  IVadEngine,
  IAsrEngine,
  VoicePageEventListener,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';
