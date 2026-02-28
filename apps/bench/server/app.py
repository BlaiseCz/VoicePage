"""
VoicePage Bench — FastAPI backend.

Provides real data to the bench frontend:
  - GET  /api/status          → environment & model status
  - GET  /api/models          → list trained ONNX models
  - GET  /api/configs         → list training configs
  - GET  /api/datasets        → scan training data on disk
  - GET  /api/logs            → list training logs
  - POST /api/evaluate        → run KWS evaluation against audio
  - POST /api/evaluate/quick  → quick eval using silence + synthetic beep
  - POST /api/jobs            → launch a training job
  - GET  /api/jobs            → list running/completed jobs
  - GET  /api/jobs/{id}       → get job detail + logs
  - DELETE /api/datasets/{keyword}  → delete a keyword's training data

Start with:
  cd apps/bench/server
  uvicorn app:app --host 0.0.0.0 --port 8787 --reload

Or from project root:
  python apps/bench/server/app.py
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import yaml
import numpy as np
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from scanner import scan_datasets, scan_models, scan_configs, scan_logs
from evaluator import KwsEvaluator, load_audio_file, GroundTruth, SAMPLE_RATE

# ── Paths ─────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
TOOLS_DIR = PROJECT_ROOT / "tools" / "openwakeword"
MODELS_DIR = PROJECT_ROOT / "models" / "kws"
CONFIGS_DIR = TOOLS_DIR / "configs"
DATA_DIR = TOOLS_DIR / "data"
OUTPUT_DIR = TOOLS_DIR / "output"
LOGS_DIR = TOOLS_DIR / "logs"
VENV_PYTHON = TOOLS_DIR / "venv" / "bin" / "python3"
TRAIN_PY = TOOLS_DIR / "train.py"

# ── State ─────────────────────────────────────────────────────────

# In-memory job store (persisted to jobs.json)
JOBS_FILE = Path(__file__).parent / "jobs.json"
jobs: dict[str, dict] = {}
evaluator: Optional[KwsEvaluator] = None

# ── App ───────────────────────────────────────────────────────────

app = FastAPI(title="VoicePage Bench API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_jobs():
    global jobs
    if JOBS_FILE.exists():
        try:
            jobs = json.loads(JOBS_FILE.read_text())
        except Exception:
            jobs = {}


def _save_jobs():
    JOBS_FILE.write_text(json.dumps(jobs, indent=2, default=str))


_load_jobs()


# ── Status ────────────────────────────────────────────────────────

@app.get("/api/status")
def get_status():
    """Environment and model status."""
    venv_ok = (TOOLS_DIR / "venv").exists()
    oww_ok = (TOOLS_DIR / "openwakeword_repo" / "openwakeword" / "train.py").exists()
    piper_ok = (TOOLS_DIR / "piper-sample-generator").exists()

    model_files = list(MODELS_DIR.glob("*.onnx")) if MODELS_DIR.exists() else []
    shared = {"melspectrogram.onnx", "embedding_model.onnx"}
    keyword_models = [f.stem for f in model_files if f.name not in shared]

    data_status = {}
    rir_dir = DATA_DIR / "mit_rirs"
    data_status["rirs"] = len(list(rir_dir.glob("*.wav"))) if rir_dir.exists() else 0
    bg_dir = DATA_DIR / "background_clips"
    data_status["background_clips"] = len(list(bg_dir.glob("*.wav"))) if bg_dir.exists() else 0
    feat = DATA_DIR / "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
    data_status["features"] = feat.exists()
    val = DATA_DIR / "validation_set_features.npy"
    data_status["validation"] = val.exists()

    return {
        "ok": True,
        "environment": {
            "venv": venv_ok,
            "openwakeword_repo": oww_ok,
            "piper_sample_generator": piper_ok,
            "venv_python": str(VENV_PYTHON) if VENV_PYTHON.exists() else None,
        },
        "models": {
            "total": len(model_files),
            "keywords": keyword_models,
            "shared": [f.name for f in model_files if f.name in shared],
        },
        "data": data_status,
        "paths": {
            "project_root": str(PROJECT_ROOT),
            "tools_dir": str(TOOLS_DIR),
            "models_dir": str(MODELS_DIR),
        },
    }


# ── Models ────────────────────────────────────────────────────────

@app.get("/api/models")
def list_models():
    return {"ok": True, "data": scan_models(str(MODELS_DIR))}


# ── Configs ───────────────────────────────────────────────────────

@app.get("/api/configs")
def list_configs():
    return {"ok": True, "data": scan_configs(str(CONFIGS_DIR))}


# ── Datasets ──────────────────────────────────────────────────────

@app.get("/api/datasets")
def get_datasets():
    summary = scan_datasets(str(TOOLS_DIR))
    return {"ok": True, "data": asdict(summary)}


@app.delete("/api/datasets/{keyword}")
def delete_dataset(keyword: str):
    """Delete all training output for a keyword."""
    kw_dir = OUTPUT_DIR / keyword
    kw_dir_min = OUTPUT_DIR / f"{keyword}_minimal"
    deleted = []
    for d in [kw_dir, kw_dir_min]:
        if d.exists():
            shutil.rmtree(d)
            deleted.append(str(d))
    if not deleted:
        raise HTTPException(404, f"No data found for keyword '{keyword}'")
    return {"ok": True, "deleted": deleted}


# ── Logs ──────────────────────────────────────────────────────────

@app.get("/api/logs")
def list_logs():
    return {"ok": True, "data": scan_logs(str(LOGS_DIR))}


# ── Evaluation ────────────────────────────────────────────────────

class EvalRequest(BaseModel):
    threshold: float = 0.5
    audio_dir: Optional[str] = None  # path to dir with .wav files + annotations
    keywords: Optional[list[str]] = None


@app.post("/api/evaluate/quick")
def quick_evaluate(req: EvalRequest):
    """
    Quick evaluation: run models against 60s of silence to measure
    false positive rate per hour, then optionally against positive clips
    if they exist in output/<keyword>/.
    """
    global evaluator
    if evaluator is None:
        evaluator = KwsEvaluator(str(MODELS_DIR))

    try:
        available_keywords = evaluator.load_models()
    except FileNotFoundError as e:
        raise HTTPException(400, str(e))

    target_keywords = req.keywords or available_keywords
    target_keywords = [k for k in target_keywords if k in available_keywords]

    if not target_keywords:
        raise HTTPException(400, "No matching keyword models found")

    results = {}
    threshold = req.threshold

    # Generate 60s of silence (baseline FP test)
    silence_duration_s = 60
    silence = np.zeros(SAMPLE_RATE * silence_duration_s, dtype=np.float32)
    silence_hours = silence_duration_s / 3600

    # Also generate 60s of white noise (harder FP test)
    noise = np.random.randn(SAMPLE_RATE * silence_duration_s).astype(np.float32) * 0.01
    noise_hours = silence_duration_s / 3600

    for kw in target_keywords:
        # Test against silence
        silence_result = evaluator.evaluate_audio(
            silence, f"silence-{kw}", [], threshold=threshold
        )
        silence_fps = sum(1 for d in silence_result.detections if d.keyword == kw)

        # Test against noise
        noise_result = evaluator.evaluate_audio(
            noise, f"noise-{kw}", [], threshold=threshold
        )
        noise_fps = sum(1 for d in noise_result.detections if d.keyword == kw)

        total_fps = silence_fps + noise_fps
        total_hours = silence_hours + noise_hours
        fp_per_hour = total_fps / total_hours if total_hours > 0 else 0

        # Check for positive clips in output directory
        positive_clips_found = 0
        true_positives = 0
        false_negatives = 0
        latencies: list[float] = []

        for out_name in [kw, f"{kw}_minimal"]:
            kw_out = OUTPUT_DIR / out_name
            if not kw_out.exists():
                continue
            # Look for generated positive clips
            for subdir in ["positive", "positive_clips", "clips", "generated_clips", "."]:
                clip_dir = kw_out / subdir if subdir != "." else kw_out
                if not clip_dir.exists():
                    continue
                wav_files = sorted(clip_dir.glob("*.wav"))[:50]  # limit to 50 for speed
                for wav in wav_files:
                    try:
                        audio = load_audio_file(wav)
                        if len(audio) < SAMPLE_RATE * 0.2:  # skip tiny files
                            continue
                        positive_clips_found += 1
                        # Ground truth: the keyword should be detected somewhere in the clip
                        gt = [GroundTruth(
                            start_ms=0,
                            end_ms=(len(audio) / SAMPLE_RATE) * 1000,
                            keyword=kw,
                        )]
                        clip_result = evaluator.evaluate_audio(
                            audio, wav.name, gt, threshold=threshold
                        )
                        true_positives += clip_result.true_positives
                        false_negatives += clip_result.false_negatives
                        latencies.extend(clip_result.latencies)
                    except Exception:
                        continue
                if positive_clips_found > 0:
                    break

        total_positive = true_positives + false_negatives
        recall = true_positives / max(total_positive, 1)
        frr = false_negatives / max(total_positive, 1)
        far = fp_per_hour / 3600  # normalize to rate

        avg_lat = float(np.mean(latencies)) if latencies else 0.0
        p95_lat = float(np.percentile(latencies, 95)) if len(latencies) >= 2 else avg_lat

        results[kw] = {
            "keyword": kw,
            "threshold": threshold,
            "silence_fps": silence_fps,
            "noise_fps": noise_fps,
            "fp_per_hour": round(fp_per_hour, 2),
            "far": round(far, 6),
            "positive_clips_tested": positive_clips_found,
            "true_positives": true_positives,
            "false_negatives": false_negatives,
            "recall": round(recall, 4),
            "frr": round(frr, 4),
            "precision": round(true_positives / max(true_positives + total_fps, 1), 4),
            "f1": round(2 * recall * (true_positives / max(true_positives + total_fps, 1)) / max(recall + (true_positives / max(true_positives + total_fps, 1)), 1e-9), 4),
            "avg_latency_ms": round(avg_lat, 1),
            "p95_latency_ms": round(p95_lat, 1),
        }

    return {
        "ok": True,
        "threshold": threshold,
        "keywords_evaluated": target_keywords,
        "test_audio": {
            "silence_seconds": silence_duration_s,
            "noise_seconds": silence_duration_s,
        },
        "per_keyword": results,
    }


@app.post("/api/evaluate")
def full_evaluate(req: EvalRequest):
    """
    Full evaluation: if audio_dir is provided, scan it for .wav files
    with optional .json annotations. Otherwise fall back to quick eval.
    """
    if not req.audio_dir:
        return quick_evaluate(req)

    audio_path = Path(req.audio_dir)
    if not audio_path.exists():
        raise HTTPException(400, f"Audio directory not found: {req.audio_dir}")

    global evaluator
    if evaluator is None:
        evaluator = KwsEvaluator(str(MODELS_DIR))

    try:
        available_keywords = evaluator.load_models()
    except FileNotFoundError as e:
        raise HTTPException(400, str(e))

    target_keywords = req.keywords or available_keywords

    all_results = []
    total_duration_s = 0

    for wav_file in sorted(audio_path.glob("*.wav")):
        try:
            audio = load_audio_file(wav_file)
        except Exception as e:
            continue

        duration_s = len(audio) / SAMPLE_RATE
        total_duration_s += duration_s

        # Look for matching annotation file
        ann_file = wav_file.with_suffix(".json")
        ground_truth = []
        if ann_file.exists():
            try:
                anns = json.loads(ann_file.read_text())
                for a in anns:
                    ground_truth.append(GroundTruth(
                        start_ms=a["start_ms"],
                        end_ms=a["end_ms"],
                        keyword=a["keyword"],
                    ))
            except Exception:
                pass

        result = evaluator.evaluate_audio(
            audio, wav_file.name, ground_truth, threshold=req.threshold
        )
        all_results.append(result)

    # Aggregate per-keyword metrics
    total_hours = total_duration_s / 3600
    per_keyword = {}
    for kw in target_keywords:
        m = evaluator.compute_metrics_at_threshold(
            all_results, total_hours, kw, req.threshold
        )
        per_keyword[kw] = asdict(m)

    return {
        "ok": True,
        "total_clips": len(all_results),
        "total_duration_hours": round(total_hours, 2),
        "threshold": req.threshold,
        "per_keyword": per_keyword,
    }


# ── Threshold sweep ───────────────────────────────────────────────

class SweepRequest(BaseModel):
    keyword: str
    thresholds: Optional[list[float]] = None


@app.post("/api/evaluate/sweep")
def threshold_sweep(req: SweepRequest):
    """
    Run evaluation at multiple thresholds for a single keyword
    to produce DET/ROC curve data. Uses silence + noise + positive clips.
    """
    global evaluator
    if evaluator is None:
        evaluator = KwsEvaluator(str(MODELS_DIR))

    try:
        available = evaluator.load_models()
    except FileNotFoundError as e:
        raise HTTPException(400, str(e))

    if req.keyword not in available:
        raise HTTPException(404, f"Keyword model '{req.keyword}' not found")

    thresholds = req.thresholds or [round(0.1 + i * 0.05, 2) for i in range(17)]

    # Build test clips: silence + noise + positive clips
    clips: list[tuple[np.ndarray, str, list[GroundTruth]]] = []

    # 30s silence (no GT)
    clips.append((np.zeros(SAMPLE_RATE * 30, dtype=np.float32), "silence", []))

    # 30s noise (no GT)
    clips.append((np.random.randn(SAMPLE_RATE * 30).astype(np.float32) * 0.01, "noise", []))

    # Positive clips from output
    for out_name in [req.keyword, f"{req.keyword}_minimal"]:
        kw_out = OUTPUT_DIR / out_name
        if not kw_out.exists():
            continue
        for subdir in ["positive", "positive_clips", "clips", "generated_clips", "."]:
            clip_dir = kw_out / subdir if subdir != "." else kw_out
            if not clip_dir.exists():
                continue
            for wav in sorted(clip_dir.glob("*.wav"))[:20]:
                try:
                    audio = load_audio_file(wav)
                    if len(audio) < SAMPLE_RATE * 0.2:
                        continue
                    gt = [GroundTruth(0, (len(audio) / SAMPLE_RATE) * 1000, req.keyword)]
                    clips.append((audio, wav.name, gt))
                except Exception:
                    continue
            break

    points = evaluator.sweep_thresholds(clips, req.keyword, thresholds)
    return {
        "ok": True,
        "keyword": req.keyword,
        "test_clips": len(clips),
        "points": [asdict(p) for p in points],
    }


# ── Training Jobs ─────────────────────────────────────────────────

class JobRequest(BaseModel):
    keyword: str
    config_template: str = "full"  # "full" | "minimal" | "custom"
    worker_target: str = "local"
    overrides: Optional[dict] = None


def _get_python() -> str:
    """Get the venv python path, or fall back to system python."""
    if VENV_PYTHON.exists():
        return str(VENV_PYTHON)
    return sys.executable


async def _run_training_job(job_id: str, keyword: str, config_path: str):
    """Background task: run train.py pipeline and stream logs."""
    job = jobs.get(job_id)
    if not job:
        return

    python = _get_python()
    stages = [
        ("generating", ["generate", "--config", config_path]),
        ("augmenting", ["augment", "--config", config_path]),
        ("training", ["train", "--config", config_path]),
        ("exporting", ["export", "--keyword", keyword]),
        ("evaluating", ["eval", "--keyword", keyword]),
    ]

    job["status"] = "generating"
    job["started_at"] = time.time()
    _save_jobs()

    for stage_name, args in stages:
        job["status"] = stage_name
        job["current_step"] = f"Running: {stage_name}"
        _save_jobs()

        cmd = [python, str(TRAIN_PY)] + args
        job["logs"].append(f"[{time.strftime('%H:%M:%S')}] $ {' '.join(cmd)}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(TOOLS_DIR),
            )

            async for line in proc.stdout:
                decoded = line.decode("utf-8", errors="replace").rstrip()
                job["logs"].append(decoded)
                # Update progress estimate
                if "step" in decoded.lower() or "Step" in decoded:
                    job["current_step"] = decoded

            await proc.wait()

            if proc.returncode != 0:
                job["status"] = "failed"
                job["error"] = f"Stage '{stage_name}' failed with exit code {proc.returncode}"
                job["logs"].append(f"[{time.strftime('%H:%M:%S')}] FAILED: {stage_name}")
                _save_jobs()
                return

            job["logs"].append(f"[{time.strftime('%H:%M:%S')}] {stage_name} complete")

        except Exception as e:
            job["status"] = "failed"
            job["error"] = str(e)
            _save_jobs()
            return

        # Update progress
        stage_idx = [s[0] for s in stages].index(stage_name)
        job["progress"] = int(((stage_idx + 1) / len(stages)) * 100)
        _save_jobs()

    job["status"] = "done"
    job["progress"] = 100
    job["completed_at"] = time.time()
    job["current_step"] = "Completed"
    _save_jobs()


@app.post("/api/jobs")
async def launch_job(req: JobRequest, background_tasks: BackgroundTasks):
    """Launch a training job for a keyword."""
    # Determine config file
    if req.config_template == "minimal":
        config_name = f"oww_{req.keyword}_minimal.yml"
    else:
        config_name = f"oww_{req.keyword}.yml"

    config_path = CONFIGS_DIR / config_name
    if not config_path.exists():
        raise HTTPException(400, f"Config not found: {config_name}")

    # If custom overrides, create a temp config
    if req.overrides and req.config_template == "custom":
        base_config = yaml.safe_load(config_path.read_text())
        base_config.update(req.overrides)
        base_config["model_name"] = req.keyword
        custom_path = OUTPUT_DIR / f"_custom_{req.keyword}.yml"
        custom_path.parent.mkdir(parents=True, exist_ok=True)
        custom_path.write_text(yaml.dump(base_config, default_flow_style=False))
        config_path = custom_path

    job_id = f"job-{uuid.uuid4().hex[:8]}"
    job = {
        "id": job_id,
        "config": {
            "keyword": req.keyword,
            "config_template": req.config_template,
            "config_file": str(config_path),
            "overrides": req.overrides,
            "worker_target": req.worker_target,
        },
        "status": "queued",
        "created_at": time.time(),
        "started_at": None,
        "completed_at": None,
        "progress": 0,
        "current_step": "Queued",
        "logs": [f"[{time.strftime('%H:%M:%S')}] Job {job_id} queued for '{req.keyword}'"],
        "error": None,
    }

    jobs[job_id] = job
    _save_jobs()

    # Launch in background
    background_tasks.add_task(_run_training_job, job_id, req.keyword, str(config_path))

    return {"ok": True, "job": job}


@app.get("/api/jobs")
def list_jobs():
    return {"ok": True, "data": list(jobs.values())}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job not found: {job_id}")
    return {"ok": True, "data": job}


# ── Confusion matrix (requires annotated test set) ────────────────

@app.post("/api/evaluate/confusion")
def confusion_matrix(req: EvalRequest):
    """
    Build a confusion matrix from annotated audio.
    Each .wav needs a .json annotation file with ground truth keywords.
    """
    if not req.audio_dir:
        # Generate a synthetic confusion estimate from quick eval
        return quick_evaluate(req)

    # Full confusion matrix requires annotated data — delegate to full eval
    return full_evaluate(req)


# ── Entry point ───────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print(f"VoicePage Bench API")
    print(f"  Project root: {PROJECT_ROOT}")
    print(f"  Models:       {MODELS_DIR}")
    print(f"  Tools:        {TOOLS_DIR}")
    print()
    uvicorn.run("app:app", host="0.0.0.0", port=8787, reload=True)
