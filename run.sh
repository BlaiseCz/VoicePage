#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VoicePage — One-shot run script
#
# Installs deps, builds packages, and starts the demo app.
#
# Usage:
#   ./run.sh              # Dev mode (hot-reload on localhost:3000)
#   ./run.sh --build      # Production build + preview
#   ./run.sh --install    # Only install deps (no start)
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="dev"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)   MODE="build";   shift ;;
    --install) MODE="install"; shift ;;
    -h|--help)
      echo "Usage: $0 [--build | --install]"
      echo ""
      echo "  (default)    Dev server with hot-reload on http://localhost:3000"
      echo "  --build      Production build + static preview on http://localhost:4173"
      echo "  --install    Install dependencies only (no start)"
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo "============================================================"
echo " VoicePage — Run"
echo "============================================================"
echo "  Mode: $MODE"
echo ""

# ---- Step 1: Check prerequisites ----
if ! command -v node &>/dev/null; then
  echo "ERROR: node is not installed. Install Node.js >= 18."
  exit 1
fi

if ! command -v pnpm &>/dev/null; then
  echo "pnpm not found — installing via corepack..."
  corepack enable
  corepack prepare pnpm@latest --activate
fi

echo "  Node:  $(node --version)"
echo "  pnpm:  $(pnpm --version)"
echo ""

# ---- Step 2: Install dependencies ----
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "[1/3] Installing dependencies..."
  pnpm install --dir "$ROOT_DIR"
else
  echo "[1/3] Dependencies already installed."
fi

if [[ "$MODE" == "install" ]]; then
  echo ""
  echo "Dependencies installed. Run ./run.sh to start the dev server."
  exit 0
fi

# ---- Step 3: Build workspace packages ----
echo "[2/3] Building workspace packages..."
pnpm --dir "$ROOT_DIR" run build

# ---- Step 4: Check models ----
MODELS_DIR="$ROOT_DIR/apps/demo-vanilla/public/models/kws"
REQUIRED_MODELS="open.onnx click.onnx stop.onnx cancel.onnx help.onnx melspectrogram.onnx embedding_model.onnx"
MISSING=0
for m in $REQUIRED_MODELS; do
  if [[ ! -f "$MODELS_DIR/$m" ]]; then
    echo "  WARN: Missing model $m in $MODELS_DIR"
    MISSING=$((MISSING + 1))
  fi
done

if [[ $MISSING -gt 0 ]]; then
  echo ""
  echo "  $MISSING model(s) missing. The demo will work in stub mode (?mode=stub)"
  echo "  but real audio mode (?mode=real) requires all models."
  echo "  Train models with:  cd tools/openwakeword && bash train.sh --minimal"
  echo ""
fi

# ---- Step 5: Start ----
if [[ "$MODE" == "dev" ]]; then
  echo "[3/3] Starting dev server..."
  echo ""
  echo "  Stub mode:  http://localhost:3000"
  echo "  Real audio: http://localhost:3000?mode=real"
  echo ""
  pnpm --dir "$ROOT_DIR" run dev
elif [[ "$MODE" == "build" ]]; then
  echo "[3/3] Building for production and previewing..."
  pnpm --dir "$ROOT_DIR/apps/demo-vanilla" run build
  echo ""
  echo "  Preview:       http://localhost:4173"
  echo "  Real audio:    http://localhost:4173?mode=real"
  echo ""
  pnpm --dir "$ROOT_DIR/apps/demo-vanilla" run preview
fi
