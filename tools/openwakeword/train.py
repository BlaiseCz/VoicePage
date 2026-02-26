#!/usr/bin/env python3
"""
VoicePage — openWakeWord training CLI.

Usage:
  python train.py generate --keyword open [--config configs/open.yaml]
  python train.py train    --config configs/open.yaml
  python train.py export   --keyword open [--output ../../models/kws/]
  python train.py eval     --keyword open [--threshold 0.5]
  python train.py all      --keyword open  # run full pipeline
"""

import argparse
import os
import sys
import yaml
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CONFIGS_DIR = SCRIPT_DIR / "configs"
OUTPUT_DIR = SCRIPT_DIR / "output"
SYNTH_DIR = SCRIPT_DIR / "synthetic_data"
MODELS_DIR = SCRIPT_DIR.parent.parent / "models" / "kws"


def load_config(config_path: str) -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def cmd_generate(args):
    """Generate synthetic positive examples for a keyword using TTS."""
    keyword = args.keyword
    config_path = args.config or CONFIGS_DIR / f"{keyword}.yaml"

    if not config_path.exists() if isinstance(config_path, Path) else not Path(config_path).exists():
        print(f"ERROR: Config not found: {config_path}")
        print(f"Available configs: {list(CONFIGS_DIR.glob('*.yaml'))}")
        sys.exit(1)

    config = load_config(str(config_path))
    gen_config = config.get("generation", {})

    output_dir = SYNTH_DIR / keyword
    output_dir.mkdir(parents=True, exist_ok=True)

    phrases = gen_config.get("phrases", [keyword])
    num_samples = gen_config.get("num_samples_per_phrase", 500)
    speaker_ids = gen_config.get("speaker_ids", list(range(10)))

    print(f"Generating synthetic data for keyword: '{keyword}'")
    print(f"  Phrases: {phrases}")
    print(f"  Samples per phrase: {num_samples}")
    print(f"  Output: {output_dir}")
    print()

    try:
        from piper import PiperVoice  # noqa: F401
        print("Using Piper TTS for generation...")
    except ImportError:
        print("WARN: piper-tts not installed. Using placeholder generation.")
        print("Install with: pip install piper-tts")
        print("Or use the Colab notebook for full TTS generation.")
        print()

    # Create a manifest file for the training step
    manifest_path = output_dir / "manifest.yaml"
    manifest = {
        "keyword": keyword,
        "phrases": phrases,
        "num_samples_target": num_samples * len(phrases),
        "output_dir": str(output_dir),
        "status": "placeholder",
        "note": (
            "This is a placeholder manifest. For real training, either:\n"
            "  1. Run with piper-tts installed for local TTS generation\n"
            "  2. Use the Colab notebook: https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEb\n"
            "  3. Use dscripka/synthetic_speech_dataset_generation repo"
        ),
    }
    with open(manifest_path, "w") as f:
        yaml.dump(manifest, f, default_flow_style=False)

    print(f"Manifest written to {manifest_path}")
    print("Done (placeholder). See manifest for next steps.")


def cmd_train(args):
    """Train a keyword classifier head using openWakeWord."""
    config_path = args.config
    if not Path(config_path).exists():
        print(f"ERROR: Config not found: {config_path}")
        sys.exit(1)

    config = load_config(config_path)
    keyword = config["keyword"]
    train_config = config.get("training", {})

    print(f"Training keyword model: '{keyword}'")
    print(f"  Config: {config_path}")
    print(f"  Epochs: {train_config.get('epochs', 50)}")
    print(f"  Batch size: {train_config.get('batch_size', 256)}")
    print(f"  Learning rate: {train_config.get('learning_rate', 0.001)}")
    print()

    try:
        import openwakeword  # noqa: F401
        print("openWakeWord is available.")
    except ImportError:
        print("ERROR: openWakeWord not installed. Run setup.sh first.")
        sys.exit(1)

    output_dir = OUTPUT_DIR / keyword
    output_dir.mkdir(parents=True, exist_ok=True)

    # In a full implementation, this would call the openWakeWord training API.
    # For now, document the manual steps:
    print("=" * 60)
    print("TRAINING INSTRUCTIONS")
    print("=" * 60)
    print()
    print("Option A — Colab (fastest):")
    print("  1. Open: https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEb")
    print(f"  2. Upload synthetic data from: {SYNTH_DIR / keyword}")
    print(f"  3. Set keyword to: '{keyword}'")
    print(f"  4. Download the output .onnx file to: {MODELS_DIR / f'{keyword}.onnx'}")
    print()
    print("Option B — Local (uses openWakeWord training notebook):")
    print(f"  1. cd {SCRIPT_DIR / 'openwakeword_repo' / 'notebooks'}")
    print("  2. Open automatic_model_training.ipynb")
    print(f"  3. Point to positive data: {SYNTH_DIR / keyword}")
    print(f"  4. Point to negative data: {SCRIPT_DIR / 'negative_data'}")
    print(f"  5. Export model to: {MODELS_DIR / f'{keyword}.onnx'}")
    print()
    print(f"Training config saved to: {output_dir / 'train_config.yaml'}")

    # Save the resolved config
    with open(output_dir / "train_config.yaml", "w") as f:
        yaml.dump(config, f, default_flow_style=False)


def cmd_export(args):
    """Export/copy a trained ONNX model to the models directory."""
    keyword = args.keyword
    output_path = Path(args.output) if args.output else MODELS_DIR

    output_path.mkdir(parents=True, exist_ok=True)
    src = OUTPUT_DIR / keyword / f"{keyword}.onnx"
    dst = output_path / f"{keyword}.onnx"

    if src.exists():
        shutil.copy2(src, dst)
        print(f"Exported: {src} -> {dst}")
    else:
        print(f"Model not found at {src}")
        print(f"Train the model first, then place the .onnx file at:")
        print(f"  {src}")
        print(f"Or manually copy to:")
        print(f"  {dst}")


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
        print()
        print("To run a full evaluation, provide test audio files:")
        print(f"  python {__file__} eval --keyword {keyword} --audio-dir <path>")
    except Exception as e:
        print(f"ERROR loading model: {e}")
        sys.exit(1)


def cmd_all(args):
    """Run the full pipeline: generate -> train -> export -> eval."""
    print(f"Running full pipeline for keyword: '{args.keyword}'")
    print("=" * 60)

    args.config = args.config or str(CONFIGS_DIR / f"{args.keyword}.yaml")
    args.output = None
    args.threshold = 0.5

    print("\n[1/4] Generate synthetic data")
    cmd_generate(args)

    print("\n[2/4] Train model")
    cmd_train(args)

    print("\n[3/4] Export model")
    cmd_export(args)

    print("\n[4/4] Evaluate model")
    # Skip eval if no model exists yet (expected for placeholder flow)
    model_path = MODELS_DIR / f"{args.keyword}.onnx"
    if model_path.exists():
        cmd_eval(args)
    else:
        print(f"Skipping eval — model not yet at {model_path}")
        print("Complete training first, then run: python train.py eval --keyword " + args.keyword)


def main():
    parser = argparse.ArgumentParser(
        description="VoicePage openWakeWord training CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # generate
    p_gen = sub.add_parser("generate", help="Generate synthetic positive examples")
    p_gen.add_argument("--keyword", required=True, help="Keyword name (e.g., open, click, stop)")
    p_gen.add_argument("--config", help="Path to YAML config (default: configs/<keyword>.yaml)")

    # train
    p_train = sub.add_parser("train", help="Train keyword classifier")
    p_train.add_argument("--config", required=True, help="Path to YAML training config")

    # export
    p_export = sub.add_parser("export", help="Export trained model to models/kws/")
    p_export.add_argument("--keyword", required=True)
    p_export.add_argument("--output", help="Output directory (default: models/kws/)")

    # eval
    p_eval = sub.add_parser("eval", help="Evaluate a trained keyword model")
    p_eval.add_argument("--keyword", required=True)
    p_eval.add_argument("--threshold", type=float, default=0.5)

    # all
    p_all = sub.add_parser("all", help="Run full pipeline: generate -> train -> export -> eval")
    p_all.add_argument("--keyword", required=True)
    p_all.add_argument("--config", help="Path to YAML config")

    args = parser.parse_args()

    {
        "generate": cmd_generate,
        "train": cmd_train,
        "export": cmd_export,
        "eval": cmd_eval,
        "all": cmd_all,
    }[args.command](args)


if __name__ == "__main__":
    main()
