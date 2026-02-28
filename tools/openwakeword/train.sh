#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VoicePage — One-shot training script
#
# Plug-and-play: clones a fresh project and trains all keyword
# models locally. Runs setup.sh if needed, downloads training
# data, then trains each keyword.
#
# Usage:
#   ./train.sh                  # Train all keywords (full)
#   ./train.sh --minimal        # Quick test (200 samples, 500 steps)
#   ./train.sh --keywords open  # Train only specific keyword(s)
#   ./train.sh --keywords "open stop click"
#   ./train.sh --minimal --keywords open  # Minimal test for one keyword
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
MODELS_DIR="$SCRIPT_DIR/../../models/kws"
LOG_DIR="$SCRIPT_DIR/logs"

ALL_KEYWORDS="open click stop cancel help"
KEYWORDS=""
MINIMAL=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --minimal)
      MINIMAL=true
      shift
      ;;
    --keywords)
      KEYWORDS="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--minimal] [--keywords \"open stop click cancel help\"]"
      echo ""
      echo "Options:"
      echo "  --minimal              Use minimal configs (fast test, ~5 min per keyword)"
      echo "  --keywords \"kw1 kw2\"   Train only specified keywords (default: all)"
      echo ""
      echo "Keywords: open, click, stop, cancel, help"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$KEYWORDS" ]]; then
  KEYWORDS="$ALL_KEYWORDS"
fi

mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOGFILE="$LOG_DIR/train_${TIMESTAMP}.log"

# Tee output to both terminal and log
exec > >(tee -a "$LOGFILE") 2>&1

echo "============================================================"
echo " VoicePage — Wake Word Model Training"
echo "============================================================"
echo ""
echo "  Keywords:  $KEYWORDS"
echo "  Mode:      $([ "$MINIMAL" = true ] && echo 'MINIMAL (quick test)' || echo 'FULL')"
echo "  Log:       $LOGFILE"
echo "  Started:   $(date)"
echo ""

# ---- Step 1: Environment setup ----
echo "============================================================"
echo " [1/4] Environment Setup"
echo "============================================================"

if [[ ! -d "$VENV_DIR" ]] || [[ ! -f "$SCRIPT_DIR/openwakeword_repo/openwakeword/train.py" ]]; then
  echo "Running setup.sh (first time)..."
  bash "$SCRIPT_DIR/setup.sh"
else
  echo "Environment already set up."
  # Still activate
  source "$VENV_DIR/bin/activate"
fi

# Ensure venv is active
if [[ -z "${VIRTUAL_ENV:-}" ]]; then
  source "$VENV_DIR/bin/activate"
fi

echo "  Python: $(python3 --version)"
echo "  venv:   $VIRTUAL_ENV"
echo ""

# ---- Step 2: Download training data ----
echo "============================================================"
echo " [2/4] Training Data"
echo "============================================================"

python3 "$SCRIPT_DIR/train.py" status 2>&1 | grep -E "(RIRs|Background|Features|Validation)" || true

# Check if data is missing
NEEDS_DATA=false
DATA_DIR="$SCRIPT_DIR/data"
if [[ ! -f "$DATA_DIR/openwakeword_features_ACAV100M_2000_hrs_16bit.npy" ]]; then
  NEEDS_DATA=true
fi
if [[ ! -f "$DATA_DIR/validation_set_features.npy" ]]; then
  NEEDS_DATA=true
fi
if [[ ! -d "$DATA_DIR/mit_rirs" ]] || [[ $(find "$DATA_DIR/mit_rirs" -name "*.wav" 2>/dev/null | wc -l) -eq 0 ]]; then
  NEEDS_DATA=true
fi

if [[ "$NEEDS_DATA" = true ]]; then
  echo ""
  echo "Downloading training data (this may take 30-60 minutes on first run)..."
  python3 "$SCRIPT_DIR/train.py" setup
else
  echo ""
  echo "All training data present."
fi
echo ""

# ---- Step 3: Train each keyword ----
echo "============================================================"
echo " [3/4] Training Keywords"
echo "============================================================"
echo ""

TRAINED=0
FAILED=0
FAILED_LIST=""

for KW in $KEYWORDS; do
  echo "------------------------------------------------------------"
  echo " Training: $KW"
  echo "------------------------------------------------------------"

  if [[ "$MINIMAL" = true ]]; then
    # Use minimal config if it exists, otherwise skip
    CONFIG="$SCRIPT_DIR/configs/oww_${KW}_minimal.yml"
    if [[ ! -f "$CONFIG" ]]; then
      echo "  No minimal config for '$KW', using full config..."
      CONFIG="$SCRIPT_DIR/configs/oww_${KW}.yml"
    fi
  else
    CONFIG="$SCRIPT_DIR/configs/oww_${KW}.yml"
  fi

  if [[ ! -f "$CONFIG" ]]; then
    echo "  SKIP: Config not found at $CONFIG"
    FAILED=$((FAILED + 1))
    FAILED_LIST="$FAILED_LIST $KW(no config)"
    continue
  fi

  echo "  Config: $CONFIG"
  echo "  Started: $(date)"
  echo ""

  if python3 "$SCRIPT_DIR/train.py" all --config "$CONFIG"; then
    TRAINED=$((TRAINED + 1))
    echo ""
    echo "  ✓ $KW trained successfully"
  else
    FAILED=$((FAILED + 1))
    FAILED_LIST="$FAILED_LIST $KW"
    echo ""
    echo "  ✗ $KW training FAILED (see log)"
  fi
  echo ""
done

# ---- Step 4: Summary ----
echo "============================================================"
echo " [4/4] Summary"
echo "============================================================"
echo ""
echo "  Trained:  $TRAINED"
echo "  Failed:   $FAILED"
if [[ -n "$FAILED_LIST" ]]; then
  echo "  Failed:  $FAILED_LIST"
fi
echo ""
echo "  Models directory: $MODELS_DIR"
if [[ -d "$MODELS_DIR" ]]; then
  echo ""
  for m in "$MODELS_DIR"/*.onnx; do
    if [[ -f "$m" ]]; then
      SIZE=$(du -h "$m" | cut -f1)
      echo "    $(basename "$m")  ($SIZE)"
    fi
  done
fi
echo ""
echo "  Finished: $(date)"
echo "  Log:      $LOGFILE"
echo ""

if [[ $FAILED -gt 0 ]]; then
  echo "Some keywords failed. Check the log for details."
  exit 1
fi

echo "All models trained successfully!"
echo ""
echo "Next: Copy models to your app or run the demo:"
echo "  pnpm --filter demo-vanilla dev"
