# VoicePage Architecture (v1)

## Overview
VoicePage is a local-first voice navigation framework for web pages. It is intentionally strict:
- deterministic routing
- explicit DOM labeling rules
- no guessing on ambiguity
- offline by default

VoicePage uses a two-stage pipeline:
1) **Tier-0: Keyword spotting (KWS)** — always-on while listening is enabled
2) **Tier-1: On-demand ASR** — short capture window after a trigger (e.g., `open` / `click`)
3) **Router + DOM index** — maps transcript to an addressable element (or candidates) and executes an action

The UI is framework-agnostic and provided via Web Components.

---

## Monorepo layout (proposed)
- `packages/voicepage-core/`
  - engine, router, state machine
  - DOM indexing + validation (collision policy)
  - KWS integration (openWakeWord)
  - VAD integration (Silero VAD ONNX)
  - ASR interface (pluggable)
- `packages/voicepage-ui/`
  - Web Components overlay UI (listening indicator, prompts, errors, highlight)
  - no framework dependencies for host apps
- `apps/demo-vanilla/`
- `apps/demo-react/`
- `apps/demo-angular/`
- `apps/bench/`
- `datasets/`
- `tools/`

---

## Runtime boundaries
### `voicepage-core` responsibilities
- Start/stop listening
- Run KWS continuously when listening is enabled
- On `open` / `click`, run a capture flow:
  - start audio capture
  - run Silero VAD to detect speech boundaries
  - pass captured audio to ASR (via `IAsrEngine`)
- Build a DOM target index on-demand (at `open` / `click` start)
- Apply deterministic normalization to transcript and labels (v1 baseline: lowercase)
- Enforce collision policy (configurable)
- Match transcript to targets:
  - exact match first
  - conservative fuzzy match second (threshold + margin)
- If misconfigured or ambiguous, **refuse to act**
- Emit a typed event stream describing what happened

### `voicepage-ui` responsibilities
- Provide a default overlay UI using Web Components:
  - listening on/off indicator
  - “say the target now” prompt after `open`
  - misconfiguration modal (duplicate labels, no target found)
  - highlight layer before click
  - optional help panel (cheat sheet)
- Subscribe to events from `voicepage-core`
- Never perform inference or routing logic

---

## Core state machine (v1)
States are explicit and finite:

- `LISTENING_OFF`
- `LISTENING_ON`
- `CAPTURING_TARGET` (after `open` / `click`)
- `TRANSCRIBING` (ASR in progress)
- `RESOLVING_TARGET` (matching + validation)
- `EXECUTING`
- `ERROR` (terminal for this request, returns to `LISTENING_ON`)

### Transitions (high-level)
- `LISTENING_OFF` -> `LISTENING_ON` when user toggles on
- `LISTENING_ON` -> `CAPTURING_TARGET` on KWS detection: `open` / `click`
- `CAPTURING_TARGET` -> `TRANSCRIBING` when VAD ends speech (>= 1s silence) or max cap hit
- `TRANSCRIBING` -> `RESOLVING_TARGET` when ASR returns transcript
- `RESOLVING_TARGET` -> `EXECUTING` if:
  - `collisionPolicy = "error"` and no collisions exist, AND match is unique and above thresholds, OR
  - `collisionPolicy = "disambiguate"` and either:
    - match is unique and above thresholds, OR
    - the user explicitly selected a candidate in the disambiguation overlay
- `RESOLVING_TARGET` -> `ERROR` if:
  - misconfiguration (duplicate labels) when `collisionPolicy = "error"`, OR
  - no match / ambiguous match
- Any state -> `LISTENING_ON` on `cancel`
- Any state -> safe interrupt on `stop` (see semantics below)

---

## Keyword semantics (strict)
Tier-0 keywords are small and stable. v1 baseline:
- `open`: starts target capture + resolution pipeline
- `click`: alias of `open`
- `stop`: hard-interrupt current continuous activity (capture, long execution)
- `cancel`: abort the pending intent, dismiss overlays, return to idle listening
- `help` (optional): show supported commands and addressable labels

STOP vs CANCEL contract:
- **STOP**: interrupts continuous processes (capture/execution)
- **CANCEL**: aborts pending intent and UI flow (modal/prompt/disambiguation)

---

## KWS: openWakeWord integration and training

### Why custom wake-word models matter
VoicePage's Tier-0 keywords (`open`, `click`, `stop`, `cancel`, `help`) must be detected reliably with very low false-accept and false-reject rates while running continuously in the browser. Generic speech recognition is too heavy and too slow for always-on keyword spotting. openWakeWord provides lightweight, custom-trained ONNX models purpose-built for this task.

Reference: [dscripka/openWakeWord](https://github.com/dscripka/openWakeWord)

### openWakeWord model architecture (summary)
Each keyword model is a three-stage pipeline:
1. **Mel-spectrogram preprocessing** — ONNX implementation of fixed-parameter mel-spectrogram extraction (16-bit 16 kHz PCM input).
2. **Shared feature extraction backbone** — a frozen convolutional embedding model (originally from Google) that converts mel-spectrograms into general-purpose speech embeddings. This is the core component; it gains its strength from extensive pre-training on large datasets and enables strong performance even when the keyword classifier is trained on synthetic data.
3. **Keyword classifier head** — a small fully-connected network or 2-layer RNN trained per keyword/phrase. This is the only part that needs retraining for each new keyword.

### VoicePage keyword models (v1)
VoicePage needs custom openWakeWord models for each Tier-0 keyword:

| Keyword   | Variations to train                         | Notes                                     |
|-----------|---------------------------------------------|-------------------------------------------|
| `open`    | "open", "open [label]"                      | primary trigger; must tolerate trailing speech |
| `click`   | "click", "click [label]"                    | alias of `open`; same behavior            |
| `stop`    | "stop"                                      | must have very low latency + high recall  |
| `cancel`  | "cancel"                                    | dismiss/abort; moderate latency OK        |
| `help`    | "help"                                      | optional in v1                            |

### Training pipeline (per keyword)
1. **Generate positive examples** using open-source TTS (e.g., [synthetic_speech_dataset_generation](https://github.com/dscripka/synthetic_speech_dataset_generation)).
   - Minimum: several thousand synthetic utterances per keyword.
   - Include variations in speed, pitch, and speaker diversity.
   - For `open` / `click`: include examples with trailing words (e.g., "open settings", "click billing") to train the model to trigger on the keyword prefix.
2. **Collect negative data** — audio where the keyword is *not* spoken.
   - Target: ~30,000 hours of mixed speech, noise, and music (reuse openWakeWord community datasets where possible).
   - Include near-miss words (e.g., "often" for "open", "stick" for "click", "stock" for "stop") as hard negatives.
3. **Train the classifier head** using the openWakeWord automated training notebook.
   - Quick path: [Google Colab notebook](https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEb?usp=sharing) (<1 hour per model).
   - Production path: [detailed training notebook](https://github.com/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb) with full control over augmentation, negative mining, and evaluation.
4. **Export** the trained classifier as an ONNX model (`.onnx`). The shared backbone and mel-spectrogram models are reused across all keywords.
5. **Evaluate** against VoicePage benchmarks (see section 7 in `docs/GOALS.md`):
   - false-accept rate target: < 0.5/hour per keyword
   - false-reject rate target: < 5%

### Runtime integration (browser)
- The shared backbone + mel-spectrogram ONNX models are loaded once at engine init.
- Per-keyword classifier ONNX models are loaded alongside.
- Inference runs via ONNX Runtime for Web (WASM backend).
- Audio is fed from an `AudioWorklet` in 80 ms frames (16-bit 16 kHz PCM).
- Each frame produces a score per keyword; if score >= `kwsThreshold` (default: 0.5), the keyword is considered detected.
- On detection, the engine emits `KeywordDetected` and transitions state accordingly.

### Threshold tuning
- Default activation threshold: `0.5` per keyword (openWakeWord recommendation).
- VoicePage exposes a per-keyword `kwsThreshold` config for deployment tuning.
- Silero VAD can be used as a secondary gate (`vad_threshold`) to suppress false positives from non-speech noise.
- `stop` should use a lower threshold / faster detection path to ensure reliable interruption.

### Model artifacts (repository layout)
Trained keyword models and shared components live under `datasets/` or a dedicated `models/` directory:
```
models/
  kws/
    melspectrogram.onnx        # shared preprocessing
    embedding_model.onnx       # shared backbone
    open.onnx                  # keyword classifier
    click.onnx
    stop.onnx
    cancel.onnx
    help.onnx                  # optional
```

### Language support
openWakeWord currently supports English only. Non-English keyword support depends on the availability of TTS models for synthetic data generation. This is acceptable for v1 (English-only scope).

---

## DOM labeling & uniqueness (strict)
VoicePage is “say what you see”, but developers can override/normalize.

Addressable element label sources (precedence):
1) `data-voice-label` (canonical)
2) accessible/visible fallback rules (defined in `docs/LABELING_SPEC.md`)

Uniqueness:
- Collisions are handled by a configurable `collisionPolicy`:
  - `disambiguate` (default): allow duplicates, but do not auto-act; require explicit user selection.
  - `error`: treat duplicates as misconfiguration; refuse to proceed and emit a `MisconfigurationError` with details.

Interaction scope (modal-first):
- If a blocking modal/popup is present, the engine restricts addressable targets to the topmost modal/popup.
- Background page elements are treated as non-addressable until the modal/popup is dismissed.

---

## Matching policy (v1)
1) **Exact match** on normalized transcript to:
   - normalized canonical labels
   - normalized synonyms
2) If none:
   - **Conservative fuzzy match** (enabled by default)
   - only accept when:
     - top score >= `fuzzyThreshold`
     - (top - second) >= `fuzzyMargin`
3) If still none or ambiguous:
   - refuse to act, emit `NoMatch` / `AmbiguousMatch`

VoicePage must not guess when uncertain.

---

## Safety policy: allow/deny lists
VoicePage supports opt-out / opt-in controls:
- global deny list (selectors that are never voice-clickable)
- per-element attributes:
  - `data-voice-deny="true"`
  - `data-voice-allow="true"` (overrides global deny)
  - `data-voice-risk="high"` (requires confirmation or extra UI step)

---

## Pluggable ASR + VAD (interfaces)
- VAD is Silero VAD ONNX by default (v1).
- ASR is pluggable via `IAsrEngine` to allow benchmarking different models.

The benchmark app will use the same interfaces and record:
- latency (ms)
- transcript output
- routing outcome
- false trigger statistics (Tier-0)

---

## Core event contract (typed)
`voicepage-core` emits a typed event stream consumed by `voicepage-ui`. Events are append-only and designed to be stable for demos, benchmarks, and host integrations.

Event common fields:
- `type`: string discriminator
- `ts`: timestamp (ms)
- `requestId`: optional string ID for a single `open` flow

Baseline event types (v1):
- `ListeningChanged` `{ enabled: boolean }`
- `KeywordDetected` `{ keyword: "open" | "click" | "stop" | "cancel" | "help", confidence?: number }`
- `CaptureStarted` `{ requestId: string }`
- `CaptureEnded` `{ requestId: string, reason: "vad" | "timeout" | "stop" | "cancel" }`
- `TranscriptionStarted` `{ requestId: string }`
- `TranscriptReady` `{ requestId: string, transcript: string }`
- `TargetIndexBuilt` `{ requestId: string, targetCount: number, scope: "page" | "modal" }`
- `TargetResolutionFailed` `{ requestId: string, reason: "no_match" | "ambiguous" | "misconfiguration", details?: unknown }`
- `TargetResolved` `{ requestId: string, targetId: string, label: string, match: "exact" | "fuzzy" }`
- `ActionProposed` `{ requestId: string, action: "click" | "focus" | "activate" | "scroll_focus", targetId: string, risk?: "high" }`
- `ActionExecuted` `{ requestId: string, action: string, targetId: string, ok: boolean, error?: string }`
- `EngineError` `{ requestId?: string, code: string, message: string, details?: unknown }`

UI guidance:
- `voicepage-ui` must be able to render reasonable prompts based solely on these events.
- `stop` should interrupt capture/execution and yield a terminating event (`CaptureEnded` / `ActionExecuted` with `ok=false`), then return the engine to idle listening.

## Error codes (v1)
Error codes are stable strings for UI and benchmarks:
- `MIC_PERMISSION_DENIED`
- `MIC_NOT_AVAILABLE`
- `KWS_INIT_FAILED`
- `VAD_INIT_FAILED`
- `ASR_INIT_FAILED`
- `ASR_FAILED`
- `NO_SPEECH_DETECTED`
- `NO_MATCH`
- `AMBIGUOUS_MATCH`
- `MISCONFIG_DUPLICATE_LABELS`
- `MISCONFIG_NO_ADDRESSABLE_TARGETS`
- `EXECUTION_FAILED`