#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VoicePage Bench — Start the backend API server
#
# This uses the same Python venv as the training tools.
# If the venv doesn't exist yet, install deps separately.
#
# Usage:
#   ./start.sh              # start on port 8787
#   ./start.sh --port 9000  # custom port
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VENV_DIR="$PROJECT_ROOT/tools/openwakeword/venv"
PORT="${1:-8787}"

# Try to use the training venv (has onnxruntime, numpy, etc.)
if [[ -d "$VENV_DIR" ]]; then
  echo "Using training venv: $VENV_DIR"
  source "$VENV_DIR/bin/activate"
else
  echo "Training venv not found at $VENV_DIR"
  echo "Creating a local venv for the bench server..."
  python3 -m venv "$SCRIPT_DIR/venv"
  source "$SCRIPT_DIR/venv/bin/activate"
fi

# Ensure FastAPI + uvicorn are installed
pip install -q fastapi uvicorn[standard] pyyaml numpy soundfile 2>/dev/null || true

echo ""
echo "============================================"
echo " VoicePage Bench API"
echo "============================================"
echo "  Port:    $PORT"
echo "  Project: $PROJECT_ROOT"
echo "  Models:  $PROJECT_ROOT/models/kws/"
echo ""
echo "  Frontend: http://localhost:3001 (or 3002)"
echo "  API docs: http://localhost:$PORT/docs"
echo "============================================"
echo ""

cd "$SCRIPT_DIR"
exec uvicorn app:app --host 0.0.0.0 --port "$PORT" --reload
