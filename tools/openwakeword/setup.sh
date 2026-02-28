#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VoicePage — openWakeWord setup script
# Creates a Python venv, installs openWakeWord + full training
# dependencies, clones required repos, and downloads shared models.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
MODELS_DIR="$SCRIPT_DIR/../../models/kws"
OWW_REPO="https://github.com/dscripka/openWakeWord.git"
OWW_DIR="$SCRIPT_DIR/openwakeword_repo"
PIPER_REPO="https://github.com/rhasspy/piper-sample-generator.git"
PIPER_DIR="$SCRIPT_DIR/piper-sample-generator"
PIPER_MODEL_URL="https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt"

echo "============================================"
echo " VoicePage — openWakeWord Setup"
echo "============================================"
echo ""

# --- Check Python ---
PYTHON=""
for candidate in python3.11 python3.10 python3 python; do
  if command -v "$candidate" &>/dev/null; then
    version=$("$candidate" --version 2>&1 | grep -oP '\d+\.\d+')
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)
    if [[ "$major" -eq 3 && "$minor" -ge 9 ]]; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [[ -z "$PYTHON" ]]; then
  echo "ERROR: Python 3.9+ is required but not found."
  echo "Install Python 3.10+ and try again."
  exit 1
fi

echo "Using Python: $PYTHON ($($PYTHON --version))"
echo ""

# --- Create venv ---
if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating virtual environment at $VENV_DIR ..."
  "$PYTHON" -m venv "$VENV_DIR"
else
  echo "Virtual environment already exists at $VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install --upgrade pip setuptools wheel

# --- Install openWakeWord (editable, for training support) ---
echo ""
echo "Cloning and installing openWakeWord..."

if [[ ! -d "$OWW_DIR" ]]; then
  git clone --depth 1 "$OWW_REPO" "$OWW_DIR"
fi

# Apply compatibility patches (piper model arg, argparse defaults, sample rate resampling)
PATCH_FILE="$SCRIPT_DIR/patches/oww-training-compat.patch"
if [[ -f "$PATCH_FILE" ]]; then
  echo "Applying openWakeWord compatibility patches..."
  pushd "$OWW_DIR" > /dev/null
  if git apply --check "$PATCH_FILE" 2>/dev/null; then
    git apply "$PATCH_FILE"
    echo "  Patches applied successfully."
  else
    echo "  Patches already applied or not needed — skipping."
  fi
  popd > /dev/null
fi

pip install -e "$OWW_DIR"

# --- Install training dependencies ---
echo ""
echo "Installing training dependencies..."
pip install -r "$SCRIPT_DIR/requirements-train.txt"

# --- Clone piper-sample-generator (for TTS-based synthetic data) ---
echo ""
if [[ ! -d "$PIPER_DIR" ]]; then
  echo "Cloning piper-sample-generator..."
  git clone --depth 1 "$PIPER_REPO" "$PIPER_DIR"
else
  echo "piper-sample-generator already cloned at $PIPER_DIR"
fi

# Download the TTS model checkpoint
if [[ ! -f "$PIPER_DIR/models/en_US-libritts_r-medium.pt" ]]; then
  echo "Downloading Piper TTS model (en_US-libritts_r-medium)..."
  mkdir -p "$PIPER_DIR/models"
  wget -q --show-progress -O "$PIPER_DIR/models/en_US-libritts_r-medium.pt" "$PIPER_MODEL_URL" \
    || echo "WARN: wget failed; download manually from $PIPER_MODEL_URL"
else
  echo "Piper TTS model already present"
fi

# --- Download shared ONNX models ---
echo ""
echo "Downloading shared openWakeWord ONNX models..."
mkdir -p "$MODELS_DIR"

python3 -c "
import openwakeword
from pathlib import Path
import shutil

# Download default models (includes shared components)
openwakeword.utils.download_models()

# Find the downloaded model directory
oww_dir = Path(openwakeword.__file__).parent / 'resources'
# Also check resources/models subdir
models_dir = oww_dir / 'models'
search_dirs = [oww_dir, models_dir] if models_dir.exists() else [oww_dir]

target = Path('$MODELS_DIR')
target.mkdir(parents=True, exist_ok=True)

for sdir in search_dirs:
    for model_file in sdir.glob('*.onnx'):
        dest = target / model_file.name
        if not dest.exists():
            shutil.copy2(model_file, dest)
            print(f'  Copied: {model_file.name}')
        else:
            print(f'  Already exists: {model_file.name}')

# Explicitly ensure shared backbone models
for name in ['melspectrogram.onnx', 'embedding_model.onnx']:
    for sdir in search_dirs:
        src = sdir / name
        if src.exists():
            dest = target / name
            shutil.copy2(src, dest)
            print(f'  Shared model: {name}')
            break
" 2>/dev/null || echo "WARN: Could not auto-download shared models. See docs/DEVELOPMENT.md for manual steps."

# --- Create output directories ---
mkdir -p "$SCRIPT_DIR/output"
mkdir -p "$SCRIPT_DIR/data"
mkdir -p "$SCRIPT_DIR/logs"

# --- Validate ---
echo ""
echo "============================================"
echo " Validation"
echo "============================================"
python3 -c "
import openwakeword
print(f'  openWakeWord version: {openwakeword.__version__}')
import onnxruntime
print(f'  ONNX Runtime version: {onnxruntime.__version__}')
import numpy
print(f'  NumPy version: {numpy.__version__}')
try:
    import torch
    print(f'  PyTorch version: {torch.__version__}')
    print(f'  CUDA available: {torch.cuda.is_available()}')
except ImportError:
    print('  PyTorch: NOT INSTALLED (CPU training only)')
try:
    import datasets
    print(f'  datasets version: {datasets.__version__}')
except ImportError:
    print('  datasets: NOT INSTALLED')
print('  All good!')
"

echo ""
echo "============================================"
echo " Setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Activate the venv:  source $VENV_DIR/bin/activate"
echo "  2. Download training data:    python train.py setup"
echo "  3. Check environment:         python train.py status"
echo "  4. Quick training test:       python train.py all --config configs/oww_open_minimal.yml"
echo "  5. Full training:             python train.py all --config configs/oww_open.yml"
echo ""
echo "See docs/DEVELOPMENT.md for full training documentation."
