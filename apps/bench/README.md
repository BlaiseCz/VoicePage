# VoicePage Bench

KWS benchmarks, training job management, and dataset tracking for VoicePage.

## Quick Start

### Frontend only (mock data)

```bash
# From project root
pnpm dev:bench
# Opens at http://localhost:3001 (or next available port)
```

The frontend works standalone with mock data — no backend required for browsing the UI.

### With real data (backend)

```bash
# Terminal 1: Start the backend API
cd apps/bench/server
./start.sh

# Terminal 2: Start the frontend
pnpm dev:bench
```

The backend runs on port **8787** and the frontend proxies `/api/*` requests to it.

The backend reuses the `tools/openwakeword/venv` Python environment. If it doesn't exist yet, run `tools/openwakeword/setup.sh` first.

## Features

### Benchmarks Tab

- **Per-keyword metrics table** — TP, FP, FN, FAR, FRR, FP/hr, precision, recall, F1, latency
- **DET Curve** — Detection Error Tradeoff (FAR vs FRR)
- **ROC Curve** — Receiver Operating Characteristic
- **Confusion Matrix** — actual keyword vs detected keyword heatmap
- **Latency chart** — avg and P95 per keyword
- **FP/hr + Recall summary** — bar chart with target line
- **Threshold sweep** — interactive slider, per-keyword FAR/FRR curves
- **Live evaluation** — runs ONNX models against silence, noise, and positive clips
- **Threshold sweep** — runs real inference at multiple thresholds for DET/ROC curves

### Training Tab

- **Job launcher** — select keyword, config template (full/minimal/custom), target worker
- **Custom parameters** — override n_samples, steps, model_type, layer_size, negatives, etc.
- **Job list** — live status, progress bar, logs, metrics for completed jobs
- **Worker status** — shows local backend + remote GPU workers
- **Real backend** — launches `train.py` pipeline (generate → augment → train → export → eval)
- **Polling** — auto-refreshes job status every 3s while running

### Datasets Tab

- **Filesystem scanner** — real file counts and sizes from `tools/openwakeword/`
- **Per-keyword breakdown** — positive clips, augmented clips, disk usage
- **Shared data** — RIRs, background clips, precomputed features
- **Disk management** — delete per-keyword data, refresh stats
- **Regenerate** — one-click to re-launch data generation for a keyword

## KWS Benchmark Metrics

The benchmarks are designed around standard keyword spotting evaluation:

| Metric | Description | Target |
|--------|-------------|--------|
| **FAR** | False Accept Rate — fraction of negative windows that trigger | < 0.002 |
| **FRR** | False Reject Rate — fraction of positive instances missed | < 0.05 |
| **FP/hr** | False positives per hour of audio | < 0.5 |
| **Precision** | TP / (TP + FP) | > 95% |
| **Recall** | TP / (TP + FN) | > 95% |
| **F1** | Harmonic mean of precision and recall | > 0.95 |
| **Avg Latency** | Average time from audio frame to detection callback | < 200ms |
| **P95 Latency** | 95th percentile detection latency | < 300ms |
| **DET Curve** | FAR vs FRR at varying thresholds | Curve in bottom-left |
| **ROC Curve** | TPR vs FPR at varying thresholds | Curve in top-left |
| **Confusion Matrix** | Which keywords get confused with each other | Diagonal-heavy |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Environment & model status |
| GET | `/api/models` | List trained ONNX models |
| GET | `/api/configs` | List training YAML configs |
| GET | `/api/datasets` | Scan training data on disk |
| GET | `/api/logs` | List training log files |
| POST | `/api/evaluate/quick` | Run quick eval (silence + noise + positive clips) |
| POST | `/api/evaluate` | Full eval with annotated audio directory |
| POST | `/api/evaluate/sweep` | Threshold sweep for DET/ROC curves |
| POST | `/api/jobs` | Launch a training job |
| GET | `/api/jobs` | List all jobs |
| GET | `/api/jobs/{id}` | Get job detail + logs |
| DELETE | `/api/datasets/{keyword}` | Delete a keyword's training data |

Interactive API docs at `http://localhost:8787/docs` when the backend is running.

## Architecture

```
apps/bench/
├── index.html          # Single-page app shell + CSS
├── src/
│   ├── main.ts         # App logic, tab routing, API integration
│   ├── api.ts          # Typed fetch client for backend
│   ├── charts.ts       # Canvas-based chart rendering (DET, ROC, CM, etc.)
│   ├── types.ts        # TypeScript types for all data structures
│   └── mock-data.ts    # Realistic mock data for offline development
├── server/
│   ├── app.py          # FastAPI backend (main server)
│   ├── evaluator.py    # KWS ONNX model evaluator
│   ├── scanner.py      # Filesystem scanner for datasets
│   ├── requirements.txt
│   └── start.sh        # One-command backend startup
├── vite.config.ts
├── package.json
└── tsconfig.json
```
