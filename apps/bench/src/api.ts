/**
 * API client for the bench backend (FastAPI on :8787, proxied via Vite).
 * Falls back to mock data when the backend is unavailable.
 */

import type {
  BenchmarkReport,
  KeywordMetrics,
  CurvePoint,
  ConfusionMatrix,
  TrainingJob,
  DatasetSummary,
  Worker,
} from './types.js';

const API_BASE = '/api';

let _backendAvailable: boolean | null = null;

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
    });
    const json = await res.json();
    if (!res.ok) {
      return { ok: false, error: json.detail || json.error || res.statusText };
    }
    _backendAvailable = true;
    return { ok: true, data: json.data ?? json };
  } catch {
    _backendAvailable = false;
    return { ok: false, error: 'Backend unavailable' };
  }
}

export function isBackendAvailable(): boolean | null {
  return _backendAvailable;
}

// ── Status ───────────────────────────────────────────────────────

export interface StatusResponse {
  environment: {
    venv: boolean;
    openwakeword_repo: boolean;
    piper_sample_generator: boolean;
    venv_python: string | null;
  };
  models: {
    total: number;
    keywords: string[];
    shared: string[];
  };
  data: {
    rirs: number;
    background_clips: number;
    features: boolean;
    validation: boolean;
  };
  paths: Record<string, string>;
}

export async function fetchStatus(): Promise<StatusResponse | null> {
  const res = await apiFetch<StatusResponse>('/status');
  return res.ok ? (res.data ?? null) : null;
}

// ── Models ───────────────────────────────────────────────────────

export interface ModelInfo {
  name: string;
  filename: string;
  size_bytes: number;
  is_shared: boolean;
  modified: number;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await apiFetch<ModelInfo[]>('/models');
  return res.ok && res.data ? res.data : [];
}

// ── Configs ──────────────────────────────────────────────────────

export interface ConfigInfo {
  filename: string;
  keyword: string;
  is_minimal: boolean;
  steps: number | null;
  n_samples: number | null;
  model_type: string | null;
  layer_size: number | null;
  target_fp_per_hour: number | null;
}

export async function fetchConfigs(): Promise<ConfigInfo[]> {
  const res = await apiFetch<ConfigInfo[]>('/configs');
  return res.ok && res.data ? res.data : [];
}

// ── Datasets ─────────────────────────────────────────────────────

export interface DatasetResponse {
  total_size_bytes: number;
  total_files: number;
  per_keyword: Record<string, { keyword: string; positive: number; augmented: number; size_bytes: number }>;
  shared: { rirs: number; background_clips: number; feature_files: number; shared_size_bytes: number };
}

export async function fetchDatasets(): Promise<DatasetResponse | null> {
  const res = await apiFetch<DatasetResponse>('/datasets');
  return res.ok ? (res.data ?? null) : null;
}

export async function deleteDataset(keyword: string): Promise<boolean> {
  const res = await apiFetch(`/datasets/${keyword}`, { method: 'DELETE' });
  return res.ok;
}

// ── Evaluation ───────────────────────────────────────────────────

export interface QuickEvalResult {
  threshold: number;
  keywords_evaluated: string[];
  test_audio: { silence_seconds: number; noise_seconds: number };
  per_keyword: Record<string, {
    keyword: string;
    threshold: number;
    silence_fps: number;
    noise_fps: number;
    fp_per_hour: number;
    far: number;
    positive_clips_tested: number;
    true_positives: number;
    false_negatives: number;
    recall: number;
    frr: number;
    precision: number;
    f1: number;
    avg_latency_ms: number;
    p95_latency_ms: number;
  }>;
}

export async function runQuickEval(threshold = 0.5, keywords?: string[]): Promise<QuickEvalResult | null> {
  const body: any = { threshold };
  if (keywords) body.keywords = keywords;
  const res = await apiFetch<QuickEvalResult>('/evaluate/quick', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.ok ? (res.data ?? null) : null;
}

export interface SweepResult {
  keyword: string;
  test_clips: number;
  points: CurvePoint[];
}

export async function runThresholdSweep(keyword: string, thresholds?: number[]): Promise<SweepResult | null> {
  const body: any = { keyword };
  if (thresholds) body.thresholds = thresholds;
  const res = await apiFetch<SweepResult>('/evaluate/sweep', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.ok ? (res.data ?? null) : null;
}

// ── Training Jobs ────────────────────────────────────────────────

export interface JobResponse {
  id: string;
  config: {
    keyword: string;
    config_template: string;
    config_file: string;
    overrides: Record<string, any> | null;
    worker_target: string;
  };
  status: string;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  progress: number;
  current_step: string;
  logs: string[];
  error: string | null;
}

export async function fetchJobs(): Promise<JobResponse[]> {
  const res = await apiFetch<JobResponse[]>('/jobs');
  return res.ok && res.data ? res.data : [];
}

export async function fetchJob(jobId: string): Promise<JobResponse | null> {
  const res = await apiFetch<JobResponse>(`/jobs/${jobId}`);
  return res.ok ? (res.data ?? null) : null;
}

export async function launchJob(
  keyword: string,
  configTemplate: string,
  workerTarget: string,
  overrides?: Record<string, any>,
): Promise<JobResponse | null> {
  const body: any = {
    keyword,
    config_template: configTemplate,
    worker_target: workerTarget,
  };
  if (overrides) body.overrides = overrides;
  const res = await apiFetch<{ job: JobResponse }>('/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.ok && res.data) {
    return (res.data as any).job ?? res.data;
  }
  return null;
}

// ── Logs ─────────────────────────────────────────────────────────

export interface LogEntry {
  filename: string;
  size_bytes: number;
  modified: number;
  tail: string[];
}

export async function fetchLogs(): Promise<LogEntry[]> {
  const res = await apiFetch<LogEntry[]>('/logs');
  return res.ok && res.data ? res.data : [];
}
