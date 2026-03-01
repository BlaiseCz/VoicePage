# VoicePage — Startup Guide

Minimal, ordered instructions to get running. For full docs see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | >= 20 | `node -v` |
| pnpm | >= 10 | `pnpm -v` |
| Python | >= 3.9 | Only needed for KWS training |

```bash
# Install pnpm if missing
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

---

## Path A: Stub Mode (no mic, no models)

Everything you need in three commands:

```bash
pnpm install
pnpm build
pnpm dev              # → http://localhost:3000
```

Or just:

```bash
./run.sh              # handles install + build + dev server
```

Type labels in the test panel to simulate voice input. No microphone or ONNX models required.

---

## Path B: Real Audio Mode (live mic + ML models)

### 1. Install JS dependencies

```bash
pnpm install
pnpm build
```

### 2. Train KWS models

```bash
cd tools/openwakeword
chmod +x setup.sh
./setup.sh                        # one-time: venv, deps, shared ONNX models

source venv/bin/activate
python train.py setup             # download training data (~2 GB)

cd ../..
bash tools/openwakeword/train.sh --minimal   # fast (~5 min), or
bash tools/openwakeword/train.sh             # full (~1-2 hrs)
```

### 3. Copy KWS models to demo

```bash
cp models/kws/*.onnx apps/demo-vanilla/public/models/kws/
```

### 4. Download VAD model

```bash
mkdir -p apps/demo-vanilla/public/models/vad
wget -O apps/demo-vanilla/public/models/vad/silero_vad.onnx \
  https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx
```

### 5. Download Whisper models

```bash
mkdir -p apps/demo-vanilla/public/models/whisper
wget -O apps/demo-vanilla/public/models/whisper/whisper-tiny-encoder.onnx \
  https://huggingface.co/onnx-community/whisper-tiny/resolve/main/onnx/encoder_model.onnx
wget -O apps/demo-vanilla/public/models/whisper/whisper-tiny-decoder.onnx \
  https://huggingface.co/onnx-community/whisper-tiny/resolve/main/onnx/decoder_model.onnx
wget -O apps/demo-vanilla/public/models/whisper/tokenizer.json \
  https://huggingface.co/onnx-community/whisper-tiny/resolve/main/tokenizer.json
```

### 6. Run

```bash
pnpm dev              # → http://localhost:3000?mode=real
```

Grant microphone access when prompted (Chrome or Firefox desktop).

---

## Docker (alternative)

```bash
docker compose up --build    # → http://localhost:3000
```

Models in `apps/demo-vanilla/public/models/` are bundled into the image, so complete steps 2-5 before building.

---

## Script Reference

| Command | What it does |
|---------|-------------|
| `./run.sh` | Full auto: install → build → dev server |
| `./run.sh --build` | Production build + preview on :4173 |
| `./run.sh --install` | Install deps only |
| `pnpm dev` | Vite dev server (hot-reload) |
| `pnpm build` | Build all workspace packages |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | TypeScript type checking |

---

## Model Checklist

All files must exist under `apps/demo-vanilla/public/models/` for real audio mode:

```
models/
├── kws/
│   ├── melspectrogram.onnx
│   ├── embedding_model.onnx
│   ├── open.onnx
│   ├── click.onnx
│   ├── stop.onnx
│   ├── cancel.onnx
│   └── help.onnx
├── vad/
│   └── silero_vad.onnx
└── whisper/
    ├── whisper-tiny-encoder.onnx
    ├── whisper-tiny-decoder.onnx
    └── tokenizer.json
```

---

## Troubleshooting

- **"SharedArrayBuffer is not defined"** — Server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Vite dev server sets these automatically.
- **Models missing warning** — Stub mode still works. Only `?mode=real` needs the ONNX files.
- **Port 3000 in use** — Vite auto-increments; check terminal output for actual URL.
