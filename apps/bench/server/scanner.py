"""
Dataset scanner — walks the training filesystem and computes
real file counts, sizes, and per-keyword breakdowns.
"""

import os
from pathlib import Path
from dataclasses import dataclass, field


@dataclass
class KeywordDataset:
    keyword: str
    positive: int = 0
    augmented: int = 0
    size_bytes: int = 0


@dataclass
class SharedData:
    rirs: int = 0
    background_clips: int = 0
    feature_files: int = 0
    shared_size_bytes: int = 0


@dataclass
class DatasetSummary:
    total_size_bytes: int = 0
    total_files: int = 0
    per_keyword: dict[str, KeywordDataset] = field(default_factory=dict)
    shared: SharedData = field(default_factory=SharedData)


def _count_files(directory: Path, extensions: set[str] | None = None) -> tuple[int, int]:
    """Count files and total size in a directory. Returns (count, bytes)."""
    count = 0
    total_bytes = 0
    if not directory.exists():
        return 0, 0
    for f in directory.rglob("*"):
        if f.is_file():
            if extensions is None or f.suffix.lower() in extensions:
                count += 1
                total_bytes += f.stat().st_size
    return count, total_bytes


def _dir_size(directory: Path) -> int:
    """Total bytes of all files in a directory tree."""
    if not directory.exists():
        return 0
    return sum(f.stat().st_size for f in directory.rglob("*") if f.is_file())


def scan_datasets(tools_dir: str) -> DatasetSummary:
    """
    Scan tools/openwakeword/ for training data.

    Expected layout:
      tools/openwakeword/
        data/
          mit_rirs/            # shared RIRs
          background_clips/    # shared background noise
          *.npy                # precomputed features
        output/
          <keyword>/           # per-keyword training output
            positive/          # generated synthetic clips
            augmented/         # augmented clips
            *.onnx             # trained model
        synthetic_data/        # piper-generated clips (older layout)
    """
    root = Path(tools_dir)
    data_dir = root / "data"
    output_dir = root / "output"
    synthetic_dir = root / "synthetic_data"

    summary = DatasetSummary()
    audio_exts = {".wav", ".mp3", ".flac", ".ogg"}

    # ── Shared data ───────────────────────────────────────────

    rir_dir = data_dir / "mit_rirs"
    rir_count, rir_bytes = _count_files(rir_dir, audio_exts)
    summary.shared.rirs = rir_count
    summary.shared.shared_size_bytes += rir_bytes

    bg_dir = data_dir / "background_clips"
    bg_count, bg_bytes = _count_files(bg_dir, audio_exts)
    summary.shared.background_clips = bg_count
    summary.shared.shared_size_bytes += bg_bytes

    # Feature .npy files
    if data_dir.exists():
        for f in data_dir.glob("*.npy"):
            summary.shared.feature_files += 1
            summary.shared.shared_size_bytes += f.stat().st_size

    summary.total_size_bytes += summary.shared.shared_size_bytes
    summary.total_files += rir_count + bg_count + summary.shared.feature_files

    # ── Per-keyword data ──────────────────────────────────────

    keywords = {"open", "click", "stop", "cancel", "help"}

    # Check output dir for each keyword
    if output_dir.exists():
        for sub in output_dir.iterdir():
            if sub.is_dir():
                kw = sub.name.replace("_minimal", "")
                if kw not in keywords:
                    keywords.add(kw)

    for kw in sorted(keywords):
        kw_data = KeywordDataset(keyword=kw)

        # Check output/<keyword>/ for generated/augmented clips
        kw_out = output_dir / kw
        kw_out_min = output_dir / f"{kw}_minimal"

        for d in [kw_out, kw_out_min]:
            if not d.exists():
                continue

            # Look for positive clips (various subdirectory names from openWakeWord)
            for pos_name in ["positive", "positive_clips", "clips", "generated_clips"]:
                pos_dir = d / pos_name
                if pos_dir.exists():
                    c, b = _count_files(pos_dir, audio_exts)
                    kw_data.positive += c
                    kw_data.size_bytes += b

            # Look for augmented clips
            for aug_name in ["augmented", "augmented_clips", "augmented_data"]:
                aug_dir = d / aug_name
                if aug_dir.exists():
                    c, b = _count_files(aug_dir, audio_exts)
                    kw_data.augmented += c
                    kw_data.size_bytes += b

            # If we didn't find organized subdirs, count all audio in the directory
            if kw_data.positive == 0 and kw_data.augmented == 0:
                c, b = _count_files(d, audio_exts)
                kw_data.positive = c
                kw_data.size_bytes = b

            # Also count other files (numpy, onnx, etc.)
            total_b = _dir_size(d)
            if total_b > kw_data.size_bytes:
                kw_data.size_bytes = total_b

        # Also check synthetic_data/<keyword>/
        syn_kw = synthetic_dir / kw
        if syn_kw.exists():
            c, b = _count_files(syn_kw, audio_exts)
            kw_data.positive += c
            kw_data.size_bytes += b

        summary.per_keyword[kw] = kw_data
        summary.total_files += kw_data.positive + kw_data.augmented
        summary.total_size_bytes += kw_data.size_bytes

    return summary


def scan_models(models_dir: str) -> list[dict]:
    """Scan models/kws/ for trained ONNX models."""
    root = Path(models_dir)
    models = []
    if not root.exists():
        return models

    shared = {"melspectrogram.onnx", "embedding_model.onnx"}
    for f in sorted(root.glob("*.onnx")):
        models.append({
            "name": f.stem,
            "filename": f.name,
            "size_bytes": f.stat().st_size,
            "is_shared": f.name in shared,
            "modified": f.stat().st_mtime,
        })
    return models


def scan_configs(configs_dir: str) -> list[dict]:
    """Scan training configs directory."""
    root = Path(configs_dir)
    configs = []
    if not root.exists():
        return configs

    import yaml
    for f in sorted(root.glob("*.yml")):
        try:
            with open(f) as fh:
                data = yaml.safe_load(fh) or {}
        except Exception:
            data = {}
        configs.append({
            "filename": f.name,
            "keyword": data.get("model_name", f.stem.replace("oww_", "").replace("_minimal", "")),
            "is_minimal": "_minimal" in f.name,
            "steps": data.get("steps"),
            "n_samples": data.get("n_samples"),
            "model_type": data.get("model_type"),
            "layer_size": data.get("layer_size"),
            "target_fp_per_hour": data.get("target_false_positives_per_hour"),
        })
    return configs


def scan_logs(logs_dir: str) -> list[dict]:
    """Scan training log files."""
    root = Path(logs_dir)
    logs = []
    if not root.exists():
        return logs

    for f in sorted(root.glob("*.log"), reverse=True):
        stat = f.stat()
        # Read last few lines for summary
        try:
            lines = f.read_text(errors="replace").strip().splitlines()
            tail = lines[-10:] if len(lines) > 10 else lines
        except Exception:
            tail = []

        logs.append({
            "filename": f.name,
            "size_bytes": stat.st_size,
            "modified": stat.st_mtime,
            "tail": tail,
        })
    return logs
