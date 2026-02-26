#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VoicePage — openWakeWord setup script
# Creates a Python venv, installs openWakeWord + dependencies,
# downloads shared models, and validates the environment.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
MODELS_DIR="$SCRIPT_DIR/../../models/kws"
OWW_REPO="https://github.com/dscripka/openWakeWord.git"
OWW_DIR="$SCRIPT_DIR/openwakeword_repo"
SYNTH_REPO="https://github.com/dscripka/synthetic_speech_dataset_generation.git"
SYNTH_DIR="$SCRIPT_DIR/synthetic_speech_generation"

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

# --- Install openWakeWord ---
echo ""
echo "Installing openWakeWord and dependencies..."
pip install openwakeword
pip install onnxruntime
pip install numpy scipy librosa soundfile
pip install pyyaml tqdm

# --- Install TTS for synthetic data generation ---
echo ""
echo "Installing TTS tools for synthetic data generation..."
pip install piper-tts 2>/dev/null || echo "WARN: piper-tts not available, install manually if needed"

# --- Clone openWakeWord repo (for training notebooks/scripts) ---
if [[ ! -d "$OWW_DIR" ]]; then
  echo ""
  echo "Cloning openWakeWord repository..."
  git clone --depth 1 "$OWW_REPO" "$OWW_DIR"
else
  echo "openWakeWord repo already cloned at $OWW_DIR"
fi

# --- Clone synthetic speech generation repo ---
if [[ ! -d "$SYNTH_DIR" ]]; then
  echo ""
  echo "Cloning synthetic speech dataset generation..."
  git clone --depth 1 "$SYNTH_REPO" "$SYNTH_DIR"
else
  echo "Synthetic speech repo already cloned at $SYNTH_DIR"
fi

# --- Download shared ONNX models ---
echo ""
echo "Downloading shared openWakeWord ONNX models..."
mkdir -p "$MODELS_DIR"

# These are the shared backbone models from openWakeWord
python3 -c "
import openwakeword
from pathlib import Path
import shutil

# Download default models (includes shared components)
openwakeword.utils.download_models()

# Find the downloaded model directory
oww_dir = Path(openwakeword.__file__).parent / 'resources'
target = Path('$MODELS_DIR')
target.mkdir(parents=True, exist_ok=True)

# Copy shared models
for model_file in oww_dir.glob('*.onnx'):
    dest = target / model_file.name
    if not dest.exists():
        shutil.copy2(model_file, dest)
        print(f'  Copied: {model_file.name}')
    else:
        print(f'  Already exists: {model_file.name}')

# Also check for melspectrogram and embedding models
for name in ['melspectrogram.onnx', 'embedding_model.onnx']:
    src = oww_dir / name
    if src.exists():
        dest = target / name
        shutil.copy2(src, dest)
        print(f'  Shared model: {name}')
" 2>/dev/null || echo "WARN: Could not auto-download shared models. See docs/DEVELOPMENT.md for manual steps."

# --- Create output directories ---
mkdir -p "$SCRIPT_DIR/output"
mkdir -p "$SCRIPT_DIR/synthetic_data"
mkdir -p "$SCRIPT_DIR/negative_data"
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
print('  All good!')
"

echo ""
echo "============================================"
echo " Setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Activate the venv:  source $VENV_DIR/bin/activate"
echo "  2. Generate synthetic data:  python train.py generate --keyword open"
echo "  3. Train a model:            python train.py train --config configs/open.yaml"
echo "  4. Export ONNX:              python train.py export --keyword open"
echo "  5. Evaluate:                 python train.py eval --keyword open"
echo ""
echo "See docs/DEVELOPMENT.md for full training documentation."
