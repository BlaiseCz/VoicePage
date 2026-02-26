# VoicePage Goals and Scope

## 1. Purpose
VoicePage provides a strict, local-first voice interface for navigating and controlling a web page. The primary objective is high precision and predictable behavior, not open-ended natural language understanding.

VoicePage is designed to make a web UI operable by voice through:
- a small set of reliable control keywords
- a deterministic router/state machine
- an explicit page annotation system ("say what you see" + developer-provided labels)
- measurable benchmarks for regression testing

## 2. Design Principles
### 2.1 Strictness over cleverness
- Prefer deterministic behavior and explicit rules.
- Avoid ambiguous interpretations.
- When uncertain, ask for disambiguation rather than guessing.

### 2.2 Local-first by default (v1)
- No required network calls.
- All inference runs in the client.
- Logs/metrics remain local (exportable for debugging).

### 2.3 Minimal always-on surface
- Keep "always listening" limited to a few keywords (Tier-0).
- Use on-demand ASR only after an explicit trigger (e.g., `open`).

### 2.4 Accessibility-aligned targeting
- Prefer page-visible text and accessible names.
- Allow explicit developer overrides via a stable DOM annotation contract.

## 3. Non-Goals (v1)
- Form dictation / rich text entry
- Cloud-based "correction" or server-side transcription
- Conversational intent parsing / LLM-based reasoning
- Full cross-browser/mobile support (desktop Chrome/Firefox first)

## 4. Core User Experience (v1)
### 4.1 User mental model
- The user is told to speak **words they see on the page**.
- VoicePage maps spoken labels to page elements deterministically.
- If multiple elements match, VoicePage shows a disambiguation overlay.

Additional rules (strict):
- Spoken targets and computed labels are normalized to **lowercase** before matching.
- If a menu/section is not currently visible, its items are not addressable until they are visible.
- If a modal/popup is open, only controls within the topmost modal/popup are addressable.

### 4.2 Primary flow: open by label
1) User enables listening (toggle UI; wake word optional later).
2) User says: `open` or `click` (or `open <label>` / `click <label>` in a single utterance).
3) VoicePage captures a short utterance (VAD-terminated) and transcribes it.
4) VoicePage matches transcript to the page label index.
5) If a single strong match exists, VoicePage executes a deterministic action (typically click).
6) If multiple matches exist, VoicePage shows a modal overlay for selection.
7) User can always say `stop` or `cancel`.

## 5. Core Semantics (v1)
### 5.1 Keywords
Tier-0 keywords are limited and carefully defined:
- **wake/toggle**: enables/disables listening (implementation choice: UI toggle in v1; wake word optional later)
- **open**: starts target capture + resolution
- **click**: alias of `open`
- **stop**: hard interrupt of ongoing capture/execution
- **cancel**: abort pending intent / dismiss overlay / return to idle
- **help** (optional): shows on-page cheat sheet of supported commands and visible labels

Each Tier-0 keyword requires a custom openWakeWord model trained for reliable detection. See `docs/ARCHITECTURE.md` § "KWS: openWakeWord integration and training" for the training pipeline, model artifacts, threshold tuning, and runtime integration details.

### 5.2 STOP vs CANCEL (strict contract)
- **STOP**: interrupts continuous processes (ASR capture, long-running actions)
- **CANCEL**: aborts pending intent and dismisses UI (disambiguation, partial action staging)

## 6. Page Annotation and Target Resolution
### 6.1 Addressable elements
An element is voice-addressable if it has:
- an explicit `data-voice-label`, or
- a usable accessible/visible label derived from strict fallback rules.

Label derivation and normalization are defined in `docs/LABELING_SPEC.md`.

### 6.2 Duplicate labels
Duplicate labels are handled explicitly:
- VoicePage must not guess when multiple targets match.
- A disambiguation overlay presents the candidates with contextual hints.

Collision handling is configurable (v1):
- `collisionPolicy = "disambiguate"` (default): allow duplicates, but require explicit user selection.
- `collisionPolicy = "error"`: treat duplicates as misconfiguration and refuse to proceed.

### 6.3 Interaction scope (modal-first)
When a blocking UI layer is present (e.g., confirm dialogs with Cancel/OK), VoicePage resolves and executes actions only within the topmost active modal/popup. Background page elements are treated as non-addressable until the modal/popup is dismissed.

### 6.4 Deterministic action mapping (default)
- If target is a button/link: click
- Else if target is an input: focus
- Else if target is a tab/menuitem: activate (click)
- Else: scroll into view + focus if possible

## 7. Benchmarking and Success Criteria
VoicePage ships with a benchmark page to measure:
- Tier-0 keyword trigger reliability (false triggers per hour, miss rate, confusion)
- routing accuracy on a scripted demo page
- disambiguation rate and time-to-action

Success is defined by:
- low false triggers for Tier-0 keywords in realistic background audio
- high routing accuracy for labeled UI elements
- predictable, explainable failure behavior (disambiguation or "not found", not silent misfires)

## 8. Roadmap (high-level)
### v1 (prototype)
- desktop Chrome/Firefox
- local-only pipeline
- navigation-only commands
- disambiguation overlay
- benchmark page + local export

### v2 (extensions)
- form filling (controlled dictation mode)
- `correct` flow (local UI edit + optional re-decode)
- optional backend correction (opt-in, explicit consent)
- richer command grammar (scroll, back, next, etc.)