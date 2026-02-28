import type {
  BenchmarkReport,
  CurvePoint,
  TrainingJob,
  DatasetSummary,
  Worker,
} from './types.js';

// ── Generate realistic DET/ROC curve points ──────────────────────

function generateCurvePoints(baseFar: number, baseFrr: number): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let t = 0.05; t <= 0.95; t += 0.025) {
    // Model FAR decreases and FRR increases with higher threshold
    const far = baseFar * Math.exp(-4 * t) + 0.001 * Math.random();
    const frr = baseFrr * (1 - Math.exp(-3 * t)) + 0.005 * Math.random();
    points.push({
      threshold: Math.round(t * 1000) / 1000,
      far: Math.max(0, Math.min(1, far)),
      frr: Math.max(0, Math.min(1, frr)),
      tpr: Math.max(0, Math.min(1, 1 - frr)),
      fpr: Math.max(0, Math.min(1, far)),
    });
  }
  return points;
}

// ── Mock benchmark report ────────────────────────────────────────

export const MOCK_REPORT: BenchmarkReport = {
  id: 'bench-001',
  createdAt: new Date().toISOString(),
  modelName: 'voicepage-kws-v1',
  modelVersion: '0.1.0',
  keywords: ['open', 'click', 'stop', 'cancel', 'help'],
  totalClips: 2400,
  totalDurationHours: 48.5,
  perKeyword: {
    open: {
      keyword: 'open',
      threshold: 0.5,
      truePositives: 472,
      falsePositives: 18,
      falseNegatives: 28,
      trueNegatives: 9482,
      far: 0.0019,
      frr: 0.056,
      fpPerHour: 0.37,
      precision: 0.963,
      recall: 0.944,
      f1: 0.953,
      avgLatencyMs: 142,
      p95LatencyMs: 218,
    },
    click: {
      keyword: 'click',
      threshold: 0.5,
      truePositives: 465,
      falsePositives: 22,
      falseNegatives: 35,
      trueNegatives: 9478,
      far: 0.0023,
      frr: 0.070,
      fpPerHour: 0.45,
      precision: 0.955,
      recall: 0.930,
      f1: 0.942,
      avgLatencyMs: 148,
      p95LatencyMs: 225,
    },
    stop: {
      keyword: 'stop',
      threshold: 0.45,
      truePositives: 488,
      falsePositives: 25,
      falseNegatives: 12,
      trueNegatives: 9475,
      far: 0.0026,
      frr: 0.024,
      fpPerHour: 0.52,
      precision: 0.951,
      recall: 0.976,
      f1: 0.963,
      avgLatencyMs: 128,
      p95LatencyMs: 195,
    },
    cancel: {
      keyword: 'cancel',
      threshold: 0.5,
      truePositives: 460,
      falsePositives: 15,
      falseNegatives: 40,
      trueNegatives: 9485,
      far: 0.0016,
      frr: 0.080,
      fpPerHour: 0.31,
      precision: 0.968,
      recall: 0.920,
      f1: 0.943,
      avgLatencyMs: 155,
      p95LatencyMs: 240,
    },
    help: {
      keyword: 'help',
      threshold: 0.5,
      truePositives: 455,
      falsePositives: 20,
      falseNegatives: 45,
      trueNegatives: 9480,
      far: 0.0021,
      frr: 0.090,
      fpPerHour: 0.41,
      precision: 0.958,
      recall: 0.910,
      f1: 0.933,
      avgLatencyMs: 150,
      p95LatencyMs: 232,
    },
  },
  curves: {
    open: generateCurvePoints(0.15, 0.06),
    click: generateCurvePoints(0.18, 0.07),
    stop: generateCurvePoints(0.20, 0.03),
    cancel: generateCurvePoints(0.12, 0.08),
    help: generateCurvePoints(0.16, 0.09),
  },
  confusionMatrix: {
    labels: ['open', 'click', 'stop', 'cancel', 'help', 'noise'],
    matrix: [
      [472,  8,  2,  3,  5,  28],  // open
      [ 12, 465, 3,  4,  6,  35],  // click
      [  1,   2, 488, 2,  0,  12], // stop
      [  3,   5,  1, 460, 4,  40], // cancel
      [  4,   6,  2,  3, 455, 45], // help
      [  6,   8,  9,  5,  7, 9465], // noise
    ],
  },
};

// ── Mock historical reports ──────────────────────────────────────

export const MOCK_HISTORY: Array<{ id: string; date: string; fpPerHour: number; avgRecall: number }> = [
  { id: 'bench-001', date: '2025-02-28', fpPerHour: 0.41, avgRecall: 0.936 },
  { id: 'bench-000', date: '2025-02-20', fpPerHour: 0.65, avgRecall: 0.891 },
  { id: 'bench-pre1', date: '2025-02-10', fpPerHour: 1.12, avgRecall: 0.842 },
  { id: 'bench-pre0', date: '2025-01-30', fpPerHour: 1.85, avgRecall: 0.780 },
];

// ── Mock training jobs ───────────────────────────────────────────

export const MOCK_JOBS: TrainingJob[] = [
  {
    id: 'job-004',
    config: {
      keyword: 'open',
      configTemplate: 'full',
      overrides: { steps: 50000, n_samples: 5000 },
      workerTarget: 'gpu-worker-1',
    },
    status: 'training',
    createdAt: '2025-02-28T14:00:00Z',
    startedAt: '2025-02-28T14:02:00Z',
    progress: 68,
    currentStep: 'Step 34000/50000 — loss: 0.0142',
    logs: [
      '[14:02:00] Starting training for "open" (50000 steps)',
      '[14:02:01] Loaded 5000 positive + 12000 negative samples',
      '[14:15:00] Step 10000 — loss: 0.0832, val_fp/hr: 1.2',
      '[14:28:00] Step 20000 — loss: 0.0341, val_fp/hr: 0.6',
      '[14:41:00] Step 30000 — loss: 0.0178, val_fp/hr: 0.4',
    ],
  },
  {
    id: 'job-003',
    config: {
      keyword: 'stop',
      configTemplate: 'full',
      overrides: { steps: 50000, n_samples: 5000, layer_size: 64 },
      workerTarget: 'gpu-worker-1',
    },
    status: 'done',
    createdAt: '2025-02-27T10:00:00Z',
    startedAt: '2025-02-27T10:05:00Z',
    completedAt: '2025-02-27T12:30:00Z',
    progress: 100,
    logs: [
      '[10:05:00] Starting training for "stop" (50000 steps)',
      '[12:25:00] Training complete — final loss: 0.0098',
      '[12:28:00] Exported stop.onnx (200KB)',
      '[12:30:00] Eval: FP/hr=0.52, recall=97.6%',
    ],
    metrics: {
      fpPerHour: 0.52,
      recall: 0.976,
      precision: 0.951,
      avgLatencyMs: 128,
    },
  },
  {
    id: 'job-002',
    config: {
      keyword: 'cancel',
      configTemplate: 'minimal',
      overrides: { steps: 500, n_samples: 200 },
      workerTarget: 'local',
    },
    status: 'done',
    createdAt: '2025-02-26T08:00:00Z',
    startedAt: '2025-02-26T08:01:00Z',
    completedAt: '2025-02-26T08:15:00Z',
    progress: 100,
    logs: [
      '[08:01:00] Quick test run for "cancel"',
      '[08:15:00] Done — model exported',
    ],
    metrics: {
      fpPerHour: 2.1,
      recall: 0.82,
      precision: 0.88,
    },
  },
  {
    id: 'job-001',
    config: {
      keyword: 'click',
      configTemplate: 'full',
      overrides: { steps: 50000, n_samples: 5000 },
      workerTarget: 'gpu-worker-1',
    },
    status: 'failed',
    createdAt: '2025-02-25T16:00:00Z',
    startedAt: '2025-02-25T16:02:00Z',
    progress: 23,
    error: 'CUDA out of memory at step 11500. Try reducing batch size or layer_size.',
    logs: [
      '[16:02:00] Starting training for "click"',
      '[16:15:00] Step 10000 — loss: 0.0654',
      '[16:18:00] ERROR: CUDA OOM at step 11500',
    ],
  },
];

// ── Mock dataset summary ─────────────────────────────────────────

export const MOCK_DATASET_SUMMARY: DatasetSummary = {
  totalSizeBytes: 14_800_000_000, // ~14.8 GB
  totalFiles: 128_450,
  perKeyword: {
    open: { positive: 5000, augmented: 15000, sizeBytes: 2_400_000_000 },
    click: { positive: 5000, augmented: 15000, sizeBytes: 2_400_000_000 },
    stop: { positive: 5000, augmented: 15000, sizeBytes: 2_400_000_000 },
    cancel: { positive: 5000, augmented: 15000, sizeBytes: 2_400_000_000 },
    help: { positive: 5000, augmented: 15000, sizeBytes: 2_400_000_000 },
  },
  shared: {
    rirs: 271,
    backgroundClips: 500,
    featureFiles: 2,
    sharedSizeBytes: 2_800_000_000,
  },
};

// ── Mock workers ─────────────────────────────────────────────────

export const MOCK_WORKERS: Worker[] = [
  {
    id: 'gpu-worker-1',
    name: 'GPU Worker 1',
    host: '192.168.1.100:8787',
    status: 'busy',
    currentJob: 'job-004',
    gpuInfo: 'NVIDIA RTX 3090 (24GB)',
    lastSeen: new Date().toISOString(),
  },
  {
    id: 'local',
    name: 'Local (CPU)',
    host: 'localhost:8787',
    status: 'online',
    gpuInfo: 'CPU only',
    lastSeen: new Date().toISOString(),
  },
  {
    id: 'gpu-worker-2',
    name: 'GPU Worker 2',
    host: '192.168.1.101:8787',
    status: 'offline',
    gpuInfo: 'NVIDIA RTX 4080 (16GB)',
    lastSeen: '2025-02-27T18:00:00Z',
  },
];
