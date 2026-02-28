"""
KWS model evaluator — runs ONNX keyword models against audio clips
and computes benchmark metrics (FAR, FRR, DET curves, confusion matrix, latency).
"""

import time
import math
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280  # 80ms at 16kHz


@dataclass
class Detection:
    timestamp_ms: float
    keyword: str
    score: float
    latency_ms: float


@dataclass
class GroundTruth:
    start_ms: float
    end_ms: float
    keyword: str


@dataclass
class ClipResult:
    clip_id: str
    detections: list[Detection] = field(default_factory=list)
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    latencies: list[float] = field(default_factory=list)


@dataclass
class CurvePoint:
    threshold: float
    far: float
    frr: float
    tpr: float
    fpr: float


@dataclass
class KeywordMetrics:
    keyword: str
    threshold: float
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    true_negatives: int = 0
    far: float = 0.0
    frr: float = 0.0
    fp_per_hour: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0
    avg_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0


class KwsEvaluator:
    """Loads openWakeWord ONNX models and evaluates them against audio."""

    def __init__(self, models_dir: str):
        self.models_dir = Path(models_dir)
        self.mel_session = None
        self.emb_session = None
        self.kw_sessions: dict[str, any] = {}
        self._loaded = False

    def load_models(self) -> list[str]:
        """Load shared backbone + all keyword classifier models. Returns keyword list."""
        import onnxruntime as ort

        mel_path = self.models_dir / "melspectrogram.onnx"
        emb_path = self.models_dir / "embedding_model.onnx"

        if not mel_path.exists() or not emb_path.exists():
            raise FileNotFoundError(
                f"Shared models not found in {self.models_dir}. "
                "Run setup.sh first."
            )

        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1

        self.mel_session = ort.InferenceSession(str(mel_path), opts)
        self.emb_session = ort.InferenceSession(str(emb_path), opts)

        # Load all keyword classifiers
        skip = {"melspectrogram.onnx", "embedding_model.onnx"}
        for onnx_file in sorted(self.models_dir.glob("*.onnx")):
            if onnx_file.name in skip:
                continue
            kw = onnx_file.stem
            self.kw_sessions[kw] = ort.InferenceSession(str(onnx_file), opts)

        self._loaded = True
        return list(self.kw_sessions.keys())

    def evaluate_audio(
        self,
        audio: np.ndarray,
        clip_id: str,
        ground_truth: list[GroundTruth],
        threshold: float = 0.5,
    ) -> ClipResult:
        """Run KWS inference on a single audio clip and match against ground truth."""
        if not self._loaded:
            raise RuntimeError("Models not loaded. Call load_models() first.")

        detections: list[Detection] = []

        # openWakeWord needs accumulated mel frames — we replicate the pipeline
        # mel buffer: accumulate 76 frames for embedding
        mel_buffer = np.zeros((1, 76, 32), dtype=np.float32)
        n_frames = len(audio) // FRAME_SAMPLES

        for i in range(n_frames):
            frame_start = i * FRAME_SAMPLES
            frame = audio[frame_start : frame_start + FRAME_SAMPLES].astype(np.float32)
            if len(frame) < FRAME_SAMPLES:
                break

            t0 = time.perf_counter()
            timestamp_ms = (frame_start / SAMPLE_RATE) * 1000

            # Mel spectrogram: [1, 1280] -> [1, 1, 5, 32]
            mel_input = frame.reshape(1, -1)
            mel_out = self.mel_session.run(None, {"input": mel_input})[0]
            # mel_out shape: (1, 1, N, 32) — typically N=5 mel frames per 80ms

            n_mel = mel_out.shape[2]
            # Shift mel buffer left and append new frames
            mel_buffer = np.roll(mel_buffer, -n_mel, axis=1)
            mel_buffer[0, -n_mel:, :] = mel_out[0, 0, :n_mel, :]

            # Embedding: [1, 76, 32, 1] -> [1, 1, 1, 96]
            emb_input = mel_buffer.reshape(1, 76, 32, 1)
            emb_out = self.emb_session.run(None, {"input": emb_input})[0]
            # emb_out shape: (1, 1, 1, 96) -> flatten to (1, 96)
            emb_flat = emb_out.reshape(1, -1)

            # Run each keyword classifier
            for kw, session in self.kw_sessions.items():
                inp_name = session.get_inputs()[0].name
                kw_out = session.run(None, {inp_name: emb_flat})[0]
                score = float(kw_out.flatten()[-1])

                latency_ms = (time.perf_counter() - t0) * 1000

                if score >= threshold:
                    detections.append(Detection(
                        timestamp_ms=timestamp_ms,
                        keyword=kw,
                        score=score,
                        latency_ms=latency_ms,
                    ))

        # Match detections to ground truth
        result = self._match_detections(clip_id, detections, ground_truth, threshold)
        return result

    def _match_detections(
        self,
        clip_id: str,
        detections: list[Detection],
        ground_truth: list[GroundTruth],
        threshold: float,
    ) -> ClipResult:
        """Match detections to ground truth with a tolerance window."""
        tolerance_ms = 500  # detection within 500ms of GT is a match
        result = ClipResult(clip_id=clip_id, detections=detections)
        matched_gt = set()
        matched_det = set()

        for gi, gt in enumerate(ground_truth):
            for di, det in enumerate(detections):
                if di in matched_det:
                    continue
                if det.keyword != gt.keyword:
                    continue
                # Detection should be near the GT window
                if (gt.start_ms - tolerance_ms) <= det.timestamp_ms <= (gt.end_ms + tolerance_ms):
                    matched_gt.add(gi)
                    matched_det.add(di)
                    result.true_positives += 1
                    result.latencies.append(det.latency_ms)
                    break

        # Unmatched detections = false positives
        result.false_positives = len(detections) - len(matched_det)

        # Unmatched ground truth = false negatives
        result.false_negatives = len(ground_truth) - len(matched_gt)

        return result

    def compute_metrics_at_threshold(
        self,
        all_results: list[ClipResult],
        total_duration_hours: float,
        keyword: str,
        threshold: float,
    ) -> KeywordMetrics:
        """Aggregate clip results into per-keyword metrics at a given threshold."""
        tp = fp = fn = 0
        latencies: list[float] = []

        for r in all_results:
            for det in r.detections:
                if det.keyword == keyword:
                    if det.score >= threshold:
                        # Check if it was a TP via the clip result
                        tp += r.true_positives
                        fp += r.false_positives
                        latencies.extend(r.latencies)
            fn += r.false_negatives

        # Deduplicate: use aggregated counts directly
        # (the clip results already have TP/FP/FN computed)
        tp = sum(r.true_positives for r in all_results)
        fp = sum(r.false_positives for r in all_results)
        fn = sum(r.false_negatives for r in all_results)

        total_positives = tp + fn
        total_negatives = fp + tp  # approximation for window-based eval

        far = fp / max(total_negatives, 1)
        frr = fn / max(total_positives, 1)
        fp_per_hour = fp / max(total_duration_hours, 0.001)
        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-9)

        avg_lat = float(np.mean(latencies)) if latencies else 0.0
        p95_lat = float(np.percentile(latencies, 95)) if len(latencies) >= 2 else avg_lat

        return KeywordMetrics(
            keyword=keyword,
            threshold=threshold,
            true_positives=tp,
            false_positives=fp,
            false_negatives=fn,
            true_negatives=0,  # not meaningful for streaming KWS
            far=far,
            frr=frr,
            fp_per_hour=fp_per_hour,
            precision=precision,
            recall=recall,
            f1=f1,
            avg_latency_ms=round(avg_lat, 1),
            p95_latency_ms=round(p95_lat, 1),
        )

    def sweep_thresholds(
        self,
        audio_clips: list[tuple[np.ndarray, str, list[GroundTruth]]],
        keyword: str,
        thresholds: Optional[list[float]] = None,
    ) -> list[CurvePoint]:
        """Run evaluation at multiple thresholds to produce DET/ROC curve points."""
        if thresholds is None:
            thresholds = [round(t * 0.025 + 0.05, 3) for t in range(37)]

        points: list[CurvePoint] = []
        total_hours = sum(len(a) / SAMPLE_RATE / 3600 for a, _, _ in audio_clips)

        for thresh in thresholds:
            results = []
            for audio, clip_id, gt in audio_clips:
                kw_gt = [g for g in gt if g.keyword == keyword]
                r = self.evaluate_audio(audio, clip_id, kw_gt, threshold=thresh)
                results.append(r)

            m = self.compute_metrics_at_threshold(results, total_hours, keyword, thresh)
            points.append(CurvePoint(
                threshold=thresh,
                far=m.far,
                frr=m.frr,
                tpr=m.recall,
                fpr=m.far,
            ))

        return points


def load_audio_file(path: str | Path) -> np.ndarray:
    """Load a WAV file as float32 mono 16kHz numpy array."""
    import soundfile as sf
    audio, sr = sf.read(str(path), dtype="float32")
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        # Simple resampling via linear interpolation
        ratio = SAMPLE_RATE / sr
        n_out = int(len(audio) * ratio)
        indices = np.linspace(0, len(audio) - 1, n_out)
        audio = np.interp(indices, np.arange(len(audio)), audio)
    return audio
