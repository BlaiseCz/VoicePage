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
# One-command setup: creates venv, installs deps, downloads shared models
cd tools/openwakeword
chmod +x setup.sh
./setup.sh
```

This will:
1. Create a Python virtual environment at `tools/openwakeword/venv/`
2. Install openWakeWord, ONNX Runtime, TTS tools
3. Clone the openWakeWord repo (for training notebooks)
4. Clone the synthetic speech generation repo
5. Download shared ONNX models (mel-spectrogram + embedding backbone)

### Training a keyword

```bash
# Activate the venv
source tools/openwakeword/venv/bin/activate

# Full pipeline for a keyword
python tools/openwakeword/train.py all --keyword open

# Or step by step:
python tools/openwakeword/train.py generate --keyword open
python tools/openwakeword/train.py train --config tools/openwakeword/configs/open.yaml
python tools/openwakeword/train.py export --keyword open
python tools/openwakeword/train.py eval --keyword open
```

### Training configs
Each keyword has a YAML config at `tools/openwakeword/configs/<keyword>.yaml`:

| Config | Key settings |
|---|---|
| `open.yaml` | Phrases with trailing words, standard thresholds |
| `click.yaml` | Same pattern as open (alias) |
| `stop.yaml` | More samples, more epochs, lower threshold (0.4), stricter miss rate |
| `cancel.yaml` | Standard settings |
| `help.yaml` | Standard settings, optional in v1 |

### Config structure
```yaml
keyword: open
generation:
  phrases: ["open", "open settings", ...]
  num_samples_per_phrase: 500
  speed_variations: [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15]
hard_negatives:
  phrases: ["often", "oven", ...]    # Similar-sounding non-keywords
training:
  epochs: 50
  batch_size: 256
  learning_rate: 0.001
  augmentation:
    noise_snr_range: [5, 30]
    room_impulse_response: true
evaluation:
  threshold: 0.5
  max_false_accepts_per_hour: 0.5
  max_false_reject_rate: 0.05
```

### Alternative: Google Colab
For fastest results without local GPU:
1. Open the [quick training Colab](https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEb)
2. Upload synthetic data from `tools/openwakeword/synthetic_data/<keyword>/`
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
