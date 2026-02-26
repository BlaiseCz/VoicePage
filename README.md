# VoicePage

VoicePage is a strict, local-first voice interface for navigating and controlling a web page. It is designed for high precision and predictable behavior, not open-ended natural language understanding.

## What it is
- A deterministic voice router: you say a visible label, VoicePage resolves it to a specific DOM element and performs a safe default action.
- Local-first by default (v1): no required network calls; logs/metrics stay local.
- Split into a headless core engine and an optional UI overlay implemented as Web Components.

## What it is not (v1)
- Conversational intent parsing / LLM reasoning
- Form dictation or rich text entry
- Full cross-browser/mobile support (desktop Chrome/Firefox first)

## Core idea: “say what you see”
- Targets are computed from:
  - `data-voice-label` (canonical developer override), or
  - strict accessible/visible label fallback rules
- Matching is deterministic and conservative.
- Labels and transcripts are normalized to lowercase in v1.

## User flow (v1)
1) User enables listening (UI toggle; wake word optional later).
2) User says: `open` or `click`.
3) VoicePage captures a short utterance (VAD-terminated) and transcribes it.
4) VoicePage resolves the transcript to a unique target or a candidate set.
5) If unique, it highlights briefly and executes (typically click).
6) If ambiguous, it shows a disambiguation overlay (depending on `collisionPolicy`).
7) `stop` interrupts; `cancel` aborts/dismisses.

## Safety and interaction scope
- VoicePage does not guess when uncertain.
- Collision handling is configurable:
  - `collisionPolicy = "disambiguate"` (default): allow duplicates but require explicit selection.
  - `collisionPolicy = "error"`: treat duplicates as misconfiguration.
- Modal-first scope: if a blocking modal/popup is open, VoicePage only targets controls within the topmost modal/popup.

## Documentation
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — **full setup, build, test, and training guide**
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, state machine, event contract
- [`docs/GOALS.md`](docs/GOALS.md) — scope, principles, success criteria
- [`docs/UI_WEB_COMPONENTS.md`](docs/UI_WEB_COMPONENTS.md) — UI component specs
- [`docs/LABELING_SPEC.md`](docs/LABELING_SPEC.md) — DOM labeling, normalization, collision rules

## Getting started

### Prerequisites
- Node.js >= 20
- pnpm (`curl -fsSL https://get.pnpm.io/install.sh | sh -`)

### Install & run
```bash
# Install dependencies
pnpm install

# Start the demo app (Vite dev server)
pnpm dev
# → opens at http://localhost:3000 (or next available port)
```

### How to use the demo
1. Click the **mic indicator** (bottom-right) or the **"Start Listening"** button to enable listening.
2. Type a label in the test panel input (e.g. `submit`, `billing`, `analytics`, `settings`).
3. Click **"Simulate Open"** (or press Enter) to simulate the full voice pipeline.
4. Watch the **Event Log** for a step-by-step trace of every engine event.
5. The target element will be highlighted and clicked automatically.
6. For ambiguous matches, a disambiguation modal will appear — click a candidate to proceed.
7. Toggle the **collision policy** dropdown between `disambiguate` and `error` to see different behaviors.

### Project structure
```
packages/voicepage-core/   # Engine, state machine, DOM indexer, matcher, events
packages/voicepage-ui/     # Web Components overlay (indicator, modal, highlight)
apps/demo-vanilla/         # Vite + vanilla TS demo page
tools/openwakeword/        # KWS model training (setup.sh, train.py, configs/)
models/kws/                # Trained ONNX models (gitignored)
docs/                      # Architecture, goals, labeling spec, UI spec, dev guide
```

### Build all packages
```bash
pnpm build
```

### openWakeWord model training
```bash
# One-command setup
cd tools/openwakeword && ./setup.sh

# Train a keyword model
source tools/openwakeword/venv/bin/activate
python tools/openwakeword/train.py all --keyword open
```

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the full training guide.

## CI/CD
- **CI** (`.github/workflows/ci.yml`): build, typecheck, lint, security audit on every push/PR
- **Deploy** (`.github/workflows/deploy-demo.yml`): deploys demo to GitHub Pages on push to `main`

## Security
- `.gitignore` covers keys, secrets, credentials, model binaries, and audio datasets
- `.env.example` documents optional env vars — copy to `.env` (gitignored) for local use
- CI includes a secret scanner that fails if common API key patterns are found in source

## Status
Early-stage prototype. APIs and specs are expected to change.