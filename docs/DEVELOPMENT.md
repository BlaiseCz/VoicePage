# VoicePage Development Guide

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Repository Structure](#repository-structure)
- [Scripts Reference](#scripts-reference)
- [Development Workflow](#development-workflow)
- [Building](#building)
- [Testing](#testing)
- [openWakeWord Model Training](#openwakeword-model-training)
- [GitHub Actions CI/CD](#github-actions-cicd)
- [Architecture Overview](#architecture-overview)
- [Security & Secrets](#security--secrets)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required
- **Node.js** >= 20 ([nvm](https://github.com/nvm-sh/nvm) recommended)
- **pnpm** >= 10

### Optional (for KWS model training)
- **Python** >= 3.9 (3.10+ recommended)
- **Git** (for cloning training repos)

### Install pnpm
```bash
# Via standalone script (recommended)
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Or via corepack (Node 20+)
corepack enable && corepack prepare pnpm@latest --activate
```

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd voicepage

# 2. Install dependencies
pnpm install

# 3. Start the demo app
pnpm dev

# Opens at http://localhost:3000 (or next available port)
```

### Using the demo
1. Click the **mic indicator** (bottom-right corner) or the **"Start Listening"** button.
2. Type a label in the test panel input (e.g. `submit`, `billing`, `analytics`, `settings`).
3. Click **"Simulate Open"** or press **Enter**.
4. Watch the **Event Log** for a step-by-step trace of every engine event.
5. The matched element is highlighted briefly and clicked.
6. For ambiguous matches, a disambiguation modal appears.
7. Toggle **collision policy** between `disambiguate` / `error` to test different behaviors.

---

## Repository Structure

```
voicepage/
├── packages/
│   ├── voicepage-core/          # Engine, state machine, DOM indexer, matcher
│   │   └── src/
│   │       ├── types.ts         # All types, events, interfaces, config
│   │       ├── engine.ts        # Main VoicePageEngine class
│   │       ├── event-bus.ts     # Typed event emitter
│   │       ├── dom-indexer.ts   # DOM scanning, label extraction, scope
│   │       ├── matcher.ts       # Exact + fuzzy matching, collision detection
│   │       ├── normalize.ts     # Label/transcript normalization
│   │       ├── action-executor.ts  # Click/focus/activate/scroll actions
│   │       └── stubs/           # Stub implementations for dev/test
│   │           ├── stub-kws.ts  # Manual keyword injection
│   │           ├── stub-vad.ts  # Auto speech-end after delay
│   │           └── stub-asr.ts  # Pre-configured transcript return
│   │
│   └── voicepage-ui/            # Web Components overlay
│       └── src/
│           ├── overlay.ts       # <voicepage-overlay> — top-level controller
│           ├── listening-indicator.ts  # <voicepage-listening-indicator>
│           ├── highlight-layer.ts      # <voicepage-highlight-layer>
│           ├── modal.ts         # <voicepage-modal> — disambiguation, errors
│           └── styles.ts        # CSS variables, shared styles
│
├── apps/
│   └── demo-vanilla/            # Vite + vanilla TypeScript demo page
│       ├── index.html
│       ├── src/main.ts          # Wires engine + UI + test panel
│       └── vite.config.ts
│
├── tools/
│   └── openwakeword/            # KWS model training tooling
│       ├── setup.sh             # One-command Python env + deps setup
│       ├── train.py             # CLI: generate, train, export, eval
│       └── configs/             # Per-keyword training YAML configs
│           ├── open.yaml
│           ├── click.yaml
│           ├── stop.yaml
│           ├── cancel.yaml
│           └── help.yaml
│
├── models/                      # ONNX model artifacts (gitignored)
│   └── kws/
│
├── docs/
│   ├── ARCHITECTURE.md          # System design, state machine, event contract
│   ├── GOALS.md                 # Scope, principles, success criteria
│   ├── UI_WEB_COMPONENTS.md     # UI component specs
│   ├── LABELING_SPEC.md         # DOM labeling, normalization, collision rules
│   └── DEVELOPMENT.md           # ← You are here
│
├── .github/workflows/
│   ├── ci.yml                   # Build, typecheck, lint, audit
│   └── deploy-demo.yml          # Deploy demo to GitHub Pages
│
├── .gitignore                   # Keys, secrets, models, build artifacts
├── .env.example                 # Template for environment variables
├── .npmrc                       # Registry override (project-local)
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

---

## Scripts Reference

### Root (monorepo)
| Script | Description |
|---|---|
| `pnpm dev` | Start the demo-vanilla dev server |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Run TypeScript type checking across all packages |
| `pnpm lint` | Run linting across all packages |

### Per-package
| Package | Script | Description |
|---|---|---|
| `voicepage-core` | `pnpm build` | Compile TypeScript to `dist/` |
| `voicepage-core` | `pnpm dev` | Watch mode |
| `voicepage-ui` | `pnpm build` | Compile TypeScript to `dist/` |
| `voicepage-ui` | `pnpm dev` | Watch mode |
| `demo-vanilla` | `pnpm dev` | Vite dev server |
| `demo-vanilla` | `pnpm build` | Production build |
| `demo-vanilla` | `pnpm preview` | Preview production build |

---

## Development Workflow

### Making changes to core
1. Edit files in `packages/voicepage-core/src/`
2. The Vite dev server (demo) uses source aliases, so changes are reflected **immediately** — no build step needed during dev.

### Making changes to UI
1. Edit files in `packages/voicepage-ui/src/`
2. Same as above — Vite resolves directly to source.

### Adding a new Web Component
1. Create the component in `packages/voicepage-ui/src/`
2. Register with `customElements.define()`
3. Export from `packages/voicepage-ui/src/index.ts`
4. Subscribe to engine events in the overlay or standalone

### Adding a new engine event
1. Add the event type to `packages/voicepage-core/src/types.ts`
2. Add to the `VoicePageEvent` union type
3. Emit from the engine at the appropriate state transition
4. Handle in `packages/voicepage-ui/src/overlay.ts`

---

## Building

```bash
# Build all packages (TypeScript compilation)
pnpm build

# Build only the demo for production
pnpm --filter demo-vanilla build

# Type check without emitting
pnpm typecheck
```

---

## Testing

### Manual testing with the demo
The demo page includes a **test panel** that lets you simulate the full voice pipeline by typing labels. This exercises:
- DOM indexing (label extraction from all visible elements)
- Normalization (lowercase, whitespace collapse)
- Exact matching (canonical labels + synonyms)
- Fuzzy matching (Levenshtein distance with threshold + margin)
- Collision detection (disambiguate vs error policy)
- Action execution (click, focus, activate, scroll_focus)
- Full event lifecycle (all events logged)

### Try these test cases
| Input | Expected behavior |
|---|---|
| `submit` | Exact match → highlight → click the Submit button |
| `billing` | Exact match via `data-voice-label` → click |
| `invoices` | Exact match via `data-voice-synonyms` → click Billing link |
| `analytics` | Exact match on tab role → activate |
| `search` | Exact match on `<label>` → focus input |
| `submti` | Fuzzy match → still resolves to Submit |
| `delete` | Ambiguous (two delete buttons) → disambiguation modal |
| `xyzzy` | No match → no-match modal |

### Collision policy testing
- Set policy to `disambiguate`: duplicate labels show a selection modal
- Set policy to `error`: duplicate labels show a misconfiguration error modal

---

## openWakeWord Model Training

VoicePage uses custom [openWakeWord](https://github.com/dscripka/openWakeWord) models for Tier-0 keyword detection (`open`, `click`, `stop`, `cancel`, `help`).

### Setup

```bash
# One-command setup: creates venv, installs all training deps, clones repos
cd tools/openwakeword
chmod +x setup.sh
./setup.sh
```

This will:
1. Create a Python virtual environment at `tools/openwakeword/venv/`
2. Clone and install openWakeWord in editable mode (includes `train.py`)
3. Install full training dependencies (PyTorch, audiomentations, speechbrain, etc.)
4. Clone `piper-sample-generator` and download the TTS model checkpoint
5. Download shared ONNX models (mel-spectrogram + embedding backbone)

### Download training data

After setup, download the required training datasets:

```bash
source tools/openwakeword/venv/bin/activate
python tools/openwakeword/train.py setup
```

This downloads:
- MIT Room Impulse Responses (for augmentation)
- Background audio clips from AudioSet (negative data)
- Precomputed openWakeWord features (~2000 hrs ACAV100M)
- Validation set features (~11 hrs)

### Training a keyword

```bash
source tools/openwakeword/venv/bin/activate

# Quick test (minimal data, 500 steps — validates pipeline works)
python tools/openwakeword/train.py all --config configs/oww_open_minimal.yml

# Full training (5000 samples, 50000 steps)
python tools/openwakeword/train.py all --config configs/oww_open.yml

# Or step by step:
python tools/openwakeword/train.py generate --config configs/oww_open.yml
python tools/openwakeword/train.py augment  --config configs/oww_open.yml
python tools/openwakeword/train.py train    --config configs/oww_open.yml
python tools/openwakeword/train.py export   --keyword open
python tools/openwakeword/train.py eval     --keyword open
```

### Check environment status

```bash
python tools/openwakeword/train.py status
```

### Training configs

Two types of configs exist:

**VoicePage keyword configs** (`configs/<keyword>.yaml`) — document keyword-specific settings, phrases, hard negatives, and evaluation thresholds.

**openWakeWord training configs** (`configs/oww_<keyword>.yml`) — passed directly to openWakeWord's `train.py`. These control the actual training pipeline:

| Config | Purpose |
|---|---|
| `oww_open.yml` | Full training config for "open" keyword |
| `oww_open_minimal.yml` | Quick test config (200 samples, 500 steps) |

### openWakeWord config structure
```yaml
model_name: "open"
target_phrase: ["open"]
custom_negative_phrases: ["often", "oven", "over"]
n_samples: 5000              # synthetic positive samples
n_samples_val: 1000           # validation samples
steps: 50000                  # training steps
model_type: "dnn"
layer_size: 32
target_false_positives_per_hour: 0.5
piper_sample_generator_path: "./piper-sample-generator"
output_dir: "./output/open"
rir_paths: ["./data/mit_rirs"]
background_paths: ["./data/background_clips"]
feature_data_files:
  "ACAV100M_sample": "./data/openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
```

### Alternative: Google Colab
For fastest results without local GPU:
1. Open the [quick training Colab](https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEb)
2. Upload synthetic data from `tools/openwakeword/output/<keyword>/`
3. Download the output `.onnx` to `models/kws/<keyword>.onnx`

### Model artifacts
Trained models go to `models/kws/` (gitignored):
```
models/kws/
  melspectrogram.onnx        # Shared (downloaded by setup.sh)
  embedding_model.onnx       # Shared (downloaded by setup.sh)
  open.onnx                  # Per-keyword classifier
  click.onnx
  stop.onnx
  cancel.onnx
  help.onnx
```

---

## Real Audio Pipeline

VoicePage supports two modes: **stub mode** (default, for UI development) and **real audio mode** (live mic + ONNX models).

### Architecture

```
Microphone → AudioWorklet (resample to 16kHz mono)
  → 80ms PCM frames (1280 samples)
    → KWS (openWakeWord ONNX: mel → embedding → classifier)
    → VAD (Silero VAD ONNX: speech boundary detection)
    → ASR (Whisper ONNX: encoder → decoder → text)
```

### Running in real mode

```bash
# Start the demo with real audio
pnpm dev
# Then navigate to: http://localhost:3000?mode=real
```

### Required model files

Place ONNX models in `apps/demo-vanilla/public/models/`:

```
public/models/
├── kws/
│   ├── melspectrogram.onnx      # Shared mel preprocessor: [1, 1280] → [1, 1, 5, 32]
│   ├── embedding_model.onnx     # Shared embedding backbone: [1, 76, 32, 1] → [1, 1, 1, 96]
│   ├── open.onnx                # Keyword classifier for "open"
│   ├── click.onnx               # Keyword classifier for "click"
│   ├── stop.onnx                # Keyword classifier for "stop"
│   ├── cancel.onnx              # Keyword classifier for "cancel"
│   └── help.onnx                # Keyword classifier for "help"
├── vad/
│   └── silero_vad.onnx          # Silero VAD v5: state=[2,1,128], sr=scalar int64
└── whisper/
    ├── whisper-tiny-encoder.onnx  # Whisper-tiny encoder: [1, 80, 3000] → [1, 1500, 384]
    ├── whisper-tiny-decoder.onnx  # Whisper-tiny decoder: input_ids + encoder_hidden_states → logits
    └── tokenizer.json             # Byte-level BPE tokenizer vocab (51865 tokens)
```

### Obtaining models

- **KWS models**: Run `bash tools/openwakeword/setup.sh` to install openWakeWord and download `melspectrogram.onnx` + `embedding_model.onnx`. Then train keyword classifiers with `bash tools/openwakeword/train.sh --minimal` (or without `--minimal` for production quality). Copy all `.onnx` files from `models/kws/` to `apps/demo-vanilla/public/models/kws/`. See [Model Training](#openwakeword-model-training) above.
- **Silero VAD**: Download from [silero-vad releases](https://github.com/snakers4/silero-vad/releases) tag `v5.1.2` → `silero_vad.onnx`
- **Whisper**: Download from [onnx-community/whisper-tiny](https://huggingface.co/onnx-community/whisper-tiny) on Hugging Face → `onnx/encoder_model.onnx`, `onnx/decoder_model.onnx`, `tokenizer.json`

### Components

| File | Purpose |
|---|---|
| `audio/pcm-processor.worklet.ts` | AudioWorklet: mic capture, resample to 16kHz, emit 80ms frames |
| `audio/audio-pipeline.ts` | Manages AudioContext, worklet, frame distribution, capture buffer |
| `engines/oww-kws-engine.ts` | openWakeWord KWS: mel → embedding → per-keyword classifiers |
| `engines/silero-vad-engine.ts` | Silero VAD: speech start/end detection from PCM frames |
| `engines/whisper-asr-engine.ts` | Whisper ASR: log-mel spectrogram → encoder → decoder → text |

### Cross-Origin Headers

Real audio mode requires `SharedArrayBuffer` for ONNX Runtime WASM threading. The Vite config sets:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For production deployment, ensure your server sends these headers.

---

## GitHub Actions CI/CD

### CI (`.github/workflows/ci.yml`)
Runs on every push/PR to `main` and `develop`:
- **Build & Test** — installs deps, builds all packages, runs typecheck (Node 20 + 22)
- **Lint** — runs linting
- **Security** — audits dependencies, scans for leaked secrets in source code

### Deploy Demo (`.github/workflows/deploy-demo.yml`)
Runs on push to `main`:
- Builds the demo-vanilla app
- Deploys to GitHub Pages

### Required setup
1. Enable **GitHub Pages** in repo settings (Source: GitHub Actions)
2. No secrets needed — everything is local-first

---

## Security & Secrets

### What is gitignored
- `.env` and all `.env.*` files (except `.env.example`)
- Private keys (`.pem`, `.key`, `*_rsa`, etc.)
- Credentials files (`credentials.json`, `service-account*.json`, `token.json`)
- Model binaries (`.onnx`, `.pb`, `.h5`, `.pt`, `.bin`)
- Audio datasets (`.wav`, `.mp3`, `.flac`)
- Python venvs and caches
- Node `node_modules/` and `dist/`

### Best practices
- **Never commit API keys.** Use `.env` files (gitignored) or CI secrets.
- Copy `.env.example` to `.env` for local config.
- The CI workflow includes a secret scanner that fails on common key patterns.
- Model artifacts are large binaries — use Git LFS or a model registry, not git.

---

## Troubleshooting

### pnpm not found
```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc
```

### npm registry errors (corporate proxy)
The project includes a local `.npmrc` that points to the public npm registry. If you need the corporate registry, update `.npmrc` accordingly.

### TypeScript lint errors in IDE
After `pnpm install`, the IDE may show "Cannot find module" errors for workspace packages. These resolve when Vite is running (it uses source aliases). To fix IDE resolution:
```bash
pnpm build  # builds .d.ts files for workspace packages
```

### Vite port already in use
Vite auto-increments the port. Check the terminal output for the actual URL.

### openWakeWord setup fails
- Ensure Python 3.9+ is installed
- If pip fails behind a proxy, set `PIP_INDEX_URL` in your environment
- For GPU training, install `onnxruntime-gpu` instead of `onnxruntime`
