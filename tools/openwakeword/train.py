#!/usr/bin/env python3
"""
VoicePage — openWakeWord training CLI.

Wraps the openWakeWord automated training pipeline
(https://github.com/dscripka/openWakeWord) with VoicePage-specific defaults.

Usage:
  python train.py setup                          # download data & deps
  python train.py generate  --config configs/oww_open.yml
  python train.py augment   --config configs/oww_open.yml
  python train.py train     --config configs/oww_open.yml
  python train.py export    --keyword open [--output ../../models/kws/]
  python train.py eval      --keyword open [--threshold 0.5]
  python train.py all       --config configs/oww_open.yml   # full pipeline
  python train.py all       --config configs/oww_open_minimal.yml  # quick test

Prerequisites:
  1. Run ./setup.sh  (creates venv, clones repos, installs deps)
  2. Run: python train.py setup  (downloads training datasets)
"""

import argparse
import os
import subprocess
import sys
import yaml
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CONFIGS_DIR = SCRIPT_DIR / "configs"
OUTPUT_DIR = SCRIPT_DIR / "output"
DATA_DIR = SCRIPT_DIR / "data"
MODELS_DIR = SCRIPT_DIR.parent.parent / "models" / "kws"
OWW_REPO_DIR = SCRIPT_DIR / "openwakeword_repo"
OWW_TRAIN_SCRIPT = OWW_REPO_DIR / "openwakeword" / "train.py"
PIPER_DIR = SCRIPT_DIR / "piper-sample-generator"


def load_config(config_path: str) -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def resolve_config_paths(config: dict) -> dict:
    """Resolve relative paths in config to absolute paths based on SCRIPT_DIR."""
    cwd = str(SCRIPT_DIR)

    def _resolve(p):
        p = Path(p)
        if not p.is_absolute():
            p = SCRIPT_DIR / p
        return str(p.resolve())

    if "output_dir" in config:
        config["output_dir"] = _resolve(config["output_dir"])
    if "piper_sample_generator_path" in config:
        config["piper_sample_generator_path"] = _resolve(config["piper_sample_generator_path"])
    if "rir_paths" in config:
        config["rir_paths"] = [_resolve(p) for p in config["rir_paths"]]
    if "background_paths" in config:
        config["background_paths"] = [_resolve(p) for p in config["background_paths"]]
    if "false_positive_validation_data_path" in config:
        config["false_positive_validation_data_path"] = _resolve(config["false_positive_validation_data_path"])
    if "feature_data_files" in config:
        config["feature_data_files"] = {
            k: _resolve(v) for k, v in config["feature_data_files"].items()
        }
    return config


def write_resolved_config(config: dict, out_path: Path) -> Path:
    """Write a config with resolved absolute paths to a temp YAML file."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)
    return out_path


def run_oww_train(config_path: str, *extra_flags):
    """Invoke openWakeWord's train.py with the given config and flags."""
    if not OWW_TRAIN_SCRIPT.exists():
        print(f"ERROR: openWakeWord train.py not found at {OWW_TRAIN_SCRIPT}")
        print("Run ./setup.sh first to clone the openWakeWord repository.")
        sys.exit(1)

    cmd = [sys.executable, str(OWW_TRAIN_SCRIPT), "--training_config", config_path, *extra_flags]
    print(f"Running: {' '.join(cmd)}")
    print()
    result = subprocess.run(cmd, cwd=str(SCRIPT_DIR))
    if result.returncode != 0:
        print(f"\nERROR: openWakeWord train.py exited with code {result.returncode}")
        sys.exit(result.returncode)


def cmd_setup(args):
    """Download training datasets (RIRs, background noise, precomputed features)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print(" VoicePage — Download Training Data")
    print("=" * 60)
    print()

    # Check dependencies
    try:
        import datasets  # noqa: F401
        import scipy  # noqa: F401
        import numpy  # noqa: F401
        from tqdm import tqdm  # noqa: F401
    except ImportError as e:
        print(f"ERROR: Missing dependency: {e}")
        print("Install training deps: pip install -r requirements-train.txt")
        sys.exit(1)

    import numpy as np
    import scipy.io.wavfile
    from tqdm import tqdm
    import datasets as ds

    # 1. Download Room Impulse Responses
    rir_dir = DATA_DIR / "mit_rirs"
    if not rir_dir.exists() or len(list(rir_dir.glob("*.wav"))) == 0:
        print("[1/4] Downloading MIT Room Impulse Responses...")
        rir_dir.mkdir(parents=True, exist_ok=True)
        rir_dataset = ds.load_dataset(
            "davidscripka/MIT_environmental_impulse_responses", split="train", streaming=True
        )
        for row in tqdm(rir_dataset, desc="RIRs"):
            name = row["audio"]["path"].split("/")[-1]
            scipy.io.wavfile.write(
                str(rir_dir / name), 16000,
                (row["audio"]["array"] * 32767).astype(np.int16),
            )
        print(f"  Saved to {rir_dir}")
    else:
        print(f"[1/4] RIRs already downloaded at {rir_dir}")

    # 2. Download background noise (a small subset of AudioSet)
    bg_dir = DATA_DIR / "background_clips"
    if not bg_dir.exists() or len(list(bg_dir.glob("*.wav"))) == 0:
        print("[2/4] Downloading background audio (AudioSet subset)...")
        bg_dir.mkdir(parents=True, exist_ok=True)
        try:
            bg_dataset = ds.load_dataset(
                "agkphysics/AudioSet", split="train", streaming=True
            )
            bg_dataset = bg_dataset.cast_column("audio", ds.Audio(sampling_rate=16000))
            count = 0
            max_clips = 500  # ~4 hours of 30s clips
            for row in tqdm(bg_dataset, total=max_clips, desc="Background"):
                name = f"bg_{count:05d}.wav"
                audio = row["audio"]["array"]
                scipy.io.wavfile.write(
                    str(bg_dir / name), 16000,
                    (audio * 32767).astype(np.int16),
                )
                count += 1
                if count >= max_clips:
                    break
            print(f"  Saved {count} clips to {bg_dir}")
        except Exception as e:
            print(f"  WARN: Could not download AudioSet: {e}")
            print("  You can manually add background .wav files (16kHz mono) to:")
            print(f"    {bg_dir}")
    else:
        print(f"[2/4] Background clips already downloaded at {bg_dir}")

    # 3. Download precomputed openWakeWord features
    features_file = DATA_DIR / "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
    if not features_file.exists():
        print("[3/4] Downloading precomputed openWakeWord features (~2000 hrs)...")
        url = "https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
        _download_file(url, features_file)
    else:
        print(f"[3/4] Features already downloaded at {features_file}")

    # 4. Download validation set features
    val_file = DATA_DIR / "validation_set_features.npy"
    if not val_file.exists():
        print("[4/4] Downloading validation set features (~11 hrs)...")
        url = "https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/validation_set_features.npy"
        _download_file(url, val_file)
    else:
        print(f"[4/4] Validation features already at {val_file}")

    print()
    print("=" * 60)
    print(" Data setup complete!")
    print("=" * 60)
    print()
    print("Next: run training with one of:")
    print(f"  python train.py all --config configs/oww_open_minimal.yml  # quick test")
    print(f"  python train.py all --config configs/oww_open.yml          # full training")


def _download_file(url: str, dest: Path):
    """Download a file using wget or urllib."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(["wget", "-q", "--show-progress", "-O", str(dest), url], check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print(f"  wget not available, using Python urllib...")
        import urllib.request
        urllib.request.urlretrieve(url, str(dest))
    print(f"  Saved to {dest}")


def cmd_generate(args):
    """Generate synthetic positive/negative clips using piper-sample-generator."""
    config_path = _resolve_and_validate_config(args.config)
    config = load_config(config_path)
    config = resolve_config_paths(config)

    # Ensure piper-sample-generator is available
    psg_path = Path(config.get("piper_sample_generator_path", str(PIPER_DIR)))
    if not psg_path.exists():
        print(f"ERROR: piper-sample-generator not found at {psg_path}")
        print("Run ./setup.sh to clone it, or:")
        print(f"  git clone https://github.com/rhasspy/piper-sample-generator {psg_path}")
        sys.exit(1)

    # Check for TTS model
    tts_model = psg_path / "models" / "en_US-libritts_r-medium.pt"
    if not tts_model.exists():
        print(f"WARN: TTS model not found at {tts_model}")
        print("Downloading...")
        tts_model.parent.mkdir(parents=True, exist_ok=True)
        _download_file(
            "https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt",
            tts_model,
        )

    resolved_path = write_resolved_config(config, SCRIPT_DIR / "output" / "_resolved_config.yml")
    print(f"Generating synthetic clips for: {config.get('target_phrase', [])}")
    run_oww_train(str(resolved_path), "--generate_clips")


def cmd_augment(args):
    """Augment generated clips with noise and RIRs."""
    config_path = _resolve_and_validate_config(args.config)
    config = load_config(config_path)
    config = resolve_config_paths(config)
    resolved_path = write_resolved_config(config, SCRIPT_DIR / "output" / "_resolved_config.yml")

    print(f"Augmenting clips for: {config.get('model_name', '?')}")
    run_oww_train(str(resolved_path), "--augment_clips")


def cmd_train(args):
    """Train the keyword classifier model."""
    config_path = _resolve_and_validate_config(args.config)
    config = load_config(config_path)
    config = resolve_config_paths(config)
    resolved_path = write_resolved_config(config, SCRIPT_DIR / "output" / "_resolved_config.yml")

    keyword = config.get("model_name", "unknown")
    print(f"Training keyword model: '{keyword}'")
    print(f"  Steps: {config.get('steps', '?')}")
    print(f"  Model type: {config.get('model_type', 'dnn')}")
    print(f"  Output: {config.get('output_dir', '?')}")
    print()

    run_oww_train(str(resolved_path), "--train_model")

    # After training, check if ONNX was produced
    output_dir = Path(config.get("output_dir", str(OUTPUT_DIR / keyword)))
    onnx_file = output_dir / f"{keyword}.onnx"
    if onnx_file.exists():
        print(f"\nModel saved to: {onnx_file}")
        print(f"Export with: python train.py export --keyword {keyword}")
    else:
        print(f"\nWARN: Expected ONNX at {onnx_file} — check training output above.")


def cmd_export(args):
    """Export/copy a trained ONNX model to the models directory."""
    keyword = args.keyword
    output_path = Path(args.output) if args.output else MODELS_DIR

    output_path.mkdir(parents=True, exist_ok=True)

    # Search for the ONNX file in output directories
    candidates = [
        OUTPUT_DIR / keyword / f"{keyword}.onnx",
        OUTPUT_DIR / f"{keyword}_minimal" / f"{keyword}.onnx",
    ]
    src = None
    for c in candidates:
        if c.exists():
            src = c
            break

    if src is None:
        # Also check for my_custom_model pattern from openWakeWord
        oww_output = SCRIPT_DIR / "my_custom_model" / f"{keyword}.onnx"
        if oww_output.exists():
            src = oww_output

    dst = output_path / f"{keyword}.onnx"

    if src and src.exists():
        shutil.copy2(src, dst)
        print(f"Exported: {src} -> {dst}")
    else:
        print(f"Model not found. Searched:")
        for c in candidates:
            print(f"  {c}")
        print(f"\nTrain the model first, then run:")
        print(f"  python train.py export --keyword {keyword}")


def cmd_eval(args):
    """Evaluate a trained keyword model."""
    keyword = args.keyword
    threshold = args.threshold
    model_path = MODELS_DIR / f"{keyword}.onnx"

    if not model_path.exists():
        print(f"Model not found: {model_path}")
        print("Train and export the model first.")
        sys.exit(1)

    print(f"Evaluating keyword model: '{keyword}'")
    print(f"  Model: {model_path}")
    print(f"  Threshold: {threshold}")
    print()

    try:
        import openwakeword
        from openwakeword.model import Model

        model = Model(wakeword_models=[str(model_path)], inference_framework="onnx")
        print(f"Model loaded successfully.")
        print(f"  Expected input: 16kHz 16-bit PCM, 80ms frames")
        print(f"  Keywords: {list(model.models.keys())}")
        print()

        # Quick inference test with silence
        import numpy as np
        silence = np.zeros(1280, dtype=np.int16)
        prediction = model.predict(silence)
        print(f"  Silence test predictions: {prediction}")
        print(f"  (All scores should be near 0 for silence)")
        print()
        print("To test with real audio:")
        print(f"  python -c \"import openwakeword; openwakeword.utils.detect_from_microphone('{model_path}')\"")
    except Exception as e:
        print(f"ERROR loading model: {e}")
        sys.exit(1)


def cmd_all(args):
    """Run the full pipeline: generate -> augment -> train -> export -> eval."""
    config_path = _resolve_and_validate_config(args.config)
    config = load_config(config_path)
    keyword = config.get("model_name", "unknown")

    print(f"Running full pipeline for keyword: '{keyword}'")
    print(f"  Config: {config_path}")
    print("=" * 60)

    print("\n[1/5] Generate synthetic clips")
    cmd_generate(args)

    print("\n[2/5] Augment clips")
    cmd_augment(args)

    print("\n[3/5] Train model")
    cmd_train(args)

    print("\n[4/5] Export model")
    export_args = argparse.Namespace(keyword=keyword, output=None)
    cmd_export(export_args)

    print("\n[5/5] Evaluate model")
    model_path = MODELS_DIR / f"{keyword}.onnx"
    if model_path.exists():
        eval_args = argparse.Namespace(keyword=keyword, threshold=0.5)
        cmd_eval(eval_args)
    else:
        print(f"Skipping eval — model not yet at {model_path}")
        print(f"Complete training first, then run: python train.py eval --keyword {keyword}")


def cmd_status(args):
    """Show the status of the training environment and data."""
    print("=" * 60)
    print(" VoicePage — Training Environment Status")
    print("=" * 60)
    print()

    # Python
    print(f"Python: {sys.version}")
    print()

    # Key packages
    for pkg in ["openwakeword", "onnxruntime", "torch", "numpy", "datasets"]:
        try:
            mod = __import__(pkg)
            ver = getattr(mod, "__version__", "installed")
            print(f"  {pkg}: {ver}")
        except ImportError:
            print(f"  {pkg}: NOT INSTALLED")
    print()

    # openWakeWord repo
    print(f"openWakeWord repo: {'OK' if OWW_REPO_DIR.exists() else 'MISSING — run ./setup.sh'}")
    print(f"  train.py: {'OK' if OWW_TRAIN_SCRIPT.exists() else 'MISSING'}")
    print()

    # piper-sample-generator
    print(f"piper-sample-generator: {'OK' if PIPER_DIR.exists() else 'MISSING — run ./setup.sh'}")
    tts_model = PIPER_DIR / "models" / "en_US-libritts_r-medium.pt"
    print(f"  TTS model: {'OK' if tts_model.exists() else 'MISSING — will download on first generate'}")
    print()

    # Data
    print(f"Training data directory: {DATA_DIR}")
    rir_dir = DATA_DIR / "mit_rirs"
    bg_dir = DATA_DIR / "background_clips"
    feat_file = DATA_DIR / "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
    val_file = DATA_DIR / "validation_set_features.npy"
    print(f"  RIRs: {len(list(rir_dir.glob('*.wav'))) if rir_dir.exists() else 0} files")
    print(f"  Background clips: {len(list(bg_dir.glob('*.wav'))) if bg_dir.exists() else 0} files")
    print(f"  Features (ACAV100M): {'OK' if feat_file.exists() else 'MISSING — run: python train.py setup'}")
    print(f"  Validation features: {'OK' if val_file.exists() else 'MISSING — run: python train.py setup'}")
    print()

    # Configs
    print(f"Configs: {CONFIGS_DIR}")
    for cfg in sorted(CONFIGS_DIR.glob("*.yml")):
        print(f"  {cfg.name}")
    print()

    # Trained models
    print(f"Models: {MODELS_DIR}")
    if MODELS_DIR.exists():
        for m in sorted(MODELS_DIR.glob("*.onnx")):
            size_mb = m.stat().st_size / (1024 * 1024)
            print(f"  {m.name} ({size_mb:.1f} MB)")
    else:
        print("  (none)")


def _resolve_and_validate_config(config_arg: str) -> str:
    """Resolve config path and validate it exists."""
    config_path = Path(config_arg)
    if not config_path.is_absolute():
        # Try relative to SCRIPT_DIR first, then CWD
        if (SCRIPT_DIR / config_path).exists():
            config_path = SCRIPT_DIR / config_path
        elif not config_path.exists():
            # Try configs dir
            in_configs = CONFIGS_DIR / config_path
            if in_configs.exists():
                config_path = in_configs

    if not config_path.exists():
        print(f"ERROR: Config not found: {config_arg}")
        print(f"Available configs:")
        for cfg in sorted(CONFIGS_DIR.glob("*.yml")):
            print(f"  {cfg.relative_to(SCRIPT_DIR)}")
        sys.exit(1)

    return str(config_path.resolve())


def main():
    parser = argparse.ArgumentParser(
        description="VoicePage openWakeWord training CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # setup
    sub.add_parser("setup", help="Download training datasets (RIRs, background, features)")

    # status
    sub.add_parser("status", help="Show training environment status")

    # generate
    p_gen = sub.add_parser("generate", help="Generate synthetic positive/negative clips")
    p_gen.add_argument("--config", required=True, help="Path to oww_*.yml config")

    # augment
    p_aug = sub.add_parser("augment", help="Augment generated clips with noise/RIR")
    p_aug.add_argument("--config", required=True, help="Path to oww_*.yml config")

    # train
    p_train = sub.add_parser("train", help="Train keyword classifier model")
    p_train.add_argument("--config", required=True, help="Path to oww_*.yml config")

    # export
    p_export = sub.add_parser("export", help="Export trained ONNX model to models/kws/")
    p_export.add_argument("--keyword", required=True)
    p_export.add_argument("--output", help="Output directory (default: models/kws/)")

    # eval
    p_eval = sub.add_parser("eval", help="Evaluate a trained keyword model")
    p_eval.add_argument("--keyword", required=True)
    p_eval.add_argument("--threshold", type=float, default=0.5)

    # all
    p_all = sub.add_parser("all", help="Run full pipeline: generate -> augment -> train -> export -> eval")
    p_all.add_argument("--config", required=True, help="Path to oww_*.yml config")

    args = parser.parse_args()

    {
        "setup": cmd_setup,
        "status": cmd_status,
        "generate": cmd_generate,
        "augment": cmd_augment,
        "train": cmd_train,
        "export": cmd_export,
        "eval": cmd_eval,
        "all": cmd_all,
    }[args.command](args)


if __name__ == "__main__":
    main()
