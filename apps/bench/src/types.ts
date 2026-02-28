// ── Benchmark Types ──────────────────────────────────────────────

/** A single KWS detection event from a benchmark run */
export interface KwsDetection {
  /** Timestamp within the audio clip (ms) */
  timestampMs: number;
  /** Which keyword was detected */
  keyword: string;
  /** Raw model confidence score [0, 1] */
  score: number;
  /** Detection latency from audio frame to callback (ms) */
  latencyMs: number;
}

/** Ground-truth annotation for a benchmark audio clip */
export interface GroundTruthEntry {
  /** Start time of the keyword in audio (ms) */
  startMs: number;
  /** End time of the keyword in audio (ms) */
  endMs: number;
  /** The actual keyword spoken */
  keyword: string;
}

/** A single audio clip used in benchmarking */
export interface BenchClip {
  id: string;
  filename: string;
  durationMs: number;
  category: 'positive' | 'negative' | 'adversarial' | 'noisy';
  groundTruth: GroundTruthEntry[];
}

/** Result of evaluating a single clip */
export interface ClipResult {
  clipId: string;
  detections: KwsDetection[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  latencies: number[];
}

/** Per-keyword metrics at a given threshold */
export interface KeywordMetrics {
  keyword: string;
  threshold: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  /** False Accept Rate (false positives / total negative windows) */
  far: number;
  /** False Reject Rate (false negatives / total positive instances) */
  frr: number;
  /** False positives per hour of audio */
  fpPerHour: number;
  /** Precision = TP / (TP + FP) */
  precision: number;
  /** Recall = TP / (TP + FN) */
  recall: number;
  /** F1 = 2 * precision * recall / (precision + recall) */
  f1: number;
  /** Average detection latency (ms) */
  avgLatencyMs: number;
  /** P95 detection latency (ms) */
  p95LatencyMs: number;
}

/** A point on the ROC / DET curve */
export interface CurvePoint {
  threshold: number;
  far: number;
  frr: number;
  tpr: number;
  fpr: number;
}

/** Full benchmark report */
export interface BenchmarkReport {
  id: string;
  createdAt: string;
  modelName: string;
  modelVersion: string;
  keywords: string[];
  totalClips: number;
  totalDurationHours: number;
  perKeyword: Record<string, KeywordMetrics>;
  curves: Record<string, CurvePoint[]>;
  confusionMatrix: ConfusionMatrix;
}

/** Confusion matrix: actual keyword → detected as */
export interface ConfusionMatrix {
  labels: string[];
  /** matrix[i][j] = count where actual=labels[i], predicted=labels[j] */
  matrix: number[][];
}

// ── Training Job Types ───────────────────────────────────────────

export type JobStatus = 'queued' | 'generating' | 'augmenting' | 'training' | 'exporting' | 'evaluating' | 'done' | 'failed';

export interface TrainingJobConfig {
  keyword: string;
  configTemplate: 'full' | 'minimal' | 'custom';
  /** Override fields in the YAML config */
  overrides: Partial<TrainingParams>;
  /** Which worker to target (hostname or 'local') */
  workerTarget: string;
}

export interface TrainingParams {
  model_name: string;
  target_phrase: string[];
  custom_negative_phrases: string[];
  n_samples: number;
  n_samples_val: number;
  steps: number;
  model_type: 'dnn' | 'rnn';
  layer_size: number;
  target_false_positives_per_hour: number;
  augmentation_rounds: number;
  max_negative_weight: number;
}

export interface TrainingJob {
  id: string;
  config: TrainingJobConfig;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: number; // 0-100
  currentStep?: string;
  logs: string[];
  metrics?: Partial<KeywordMetrics>;
  error?: string;
}

// ── Dataset Types ────────────────────────────────────────────────

export interface DatasetEntry {
  id: string;
  keyword: string;
  category: 'positive_synthetic' | 'positive_augmented' | 'negative' | 'rir' | 'background' | 'features' | 'validation';
  path: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
  jobId?: string;
}

export interface DatasetSummary {
  totalSizeBytes: number;
  totalFiles: number;
  perKeyword: Record<string, {
    positive: number;
    augmented: number;
    sizeBytes: number;
  }>;
  shared: {
    rirs: number;
    backgroundClips: number;
    featureFiles: number;
    sharedSizeBytes: number;
  };
}

// ── Worker Types ─────────────────────────────────────────────────

export interface Worker {
  id: string;
  name: string;
  host: string;
  status: 'online' | 'busy' | 'offline';
  currentJob?: string;
  gpuInfo?: string;
  lastSeen: string;
}

// ── API Responses ────────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
