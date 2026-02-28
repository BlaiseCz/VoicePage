import {
  drawDETCurve,
  drawROCCurve,
  drawConfusionMatrix,
  drawLatencyChart,
  drawSummaryBars,
  drawThresholdSweep,
} from './charts.js';
import {
  MOCK_REPORT,
  MOCK_HISTORY,
  MOCK_JOBS,
  MOCK_DATASET_SUMMARY,
  MOCK_WORKERS,
} from './mock-data.js';
import * as api from './api.js';
import type { TrainingJob, TrainingParams, JobStatus, KeywordMetrics, CurvePoint, BenchmarkReport } from './types.js';

// ── State ────────────────────────────────────────────────────────

let activeTab: 'benchmarks' | 'training' | 'datasets' = 'benchmarks';
let thresholdKeyword = 'open';
let thresholdValue = 0.5;
let jobs: TrainingJob[] = [...MOCK_JOBS];
let useRealData = false;
let backendStatus: api.StatusResponse | null = null;

// Live data caches (populated from API when available)
let liveReport: BenchmarkReport | null = null;
let liveCurves: Record<string, CurvePoint[]> = {};
let liveDatasets: api.DatasetResponse | null = null;
let liveJobs: api.JobResponse[] = [];

// ── Tab Navigation ───────────────────────────────────────────────

function initTabs(): void {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = (tab as HTMLElement).dataset.tab as typeof activeTab;
      if (target) switchTab(target);
    });
  });
}

function switchTab(tab: typeof activeTab): void {
  activeTab = tab;
  document.querySelectorAll('.nav-tab').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach((el) => {
    (el as HTMLElement).style.display = el.id === `tab-${tab}` ? 'block' : 'none';
  });
  if (tab === 'benchmarks') renderBenchmarks();
  if (tab === 'training') renderTraining();
  if (tab === 'datasets') renderDatasets();
}

// ── Benchmarks Tab ───────────────────────────────────────────────

function renderBenchmarks(): void {
  renderMetricsCards();
  renderCharts();
  renderBenchHistory();
  renderRunEvalButton();
}

function getReport(): BenchmarkReport {
  return liveReport ?? MOCK_REPORT;
}

function renderMetricsCards(): void {
  const container = document.getElementById('metrics-cards')!;
  const report = getReport();
  const keywords = report.keywords;

  const modeLabel = useRealData
    ? '<span class="data-badge data-live">Live Data</span>'
    : '<span class="data-badge data-mock">Mock Data — start backend for real metrics</span>';

  container.innerHTML = `
    <div class="data-mode">${modeLabel}</div>
    <div class="metrics-overview">
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${report.totalDurationHours}h</div>
        <div class="metric-label">Total Audio Tested</div>
      </div>
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${report.totalClips}</div>
        <div class="metric-label">Test Clips</div>
      </div>
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${avgMetric(keywords, 'fpPerHour').toFixed(2)}</div>
        <div class="metric-label">Avg FP/Hour</div>
        <div class="metric-target ${avgMetric(keywords, 'fpPerHour') < 0.5 ? 'pass' : 'fail'}">
          target: &lt; 0.5
        </div>
      </div>
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${(avgMetric(keywords, 'recall') * 100).toFixed(1)}%</div>
        <div class="metric-label">Avg Recall</div>
        <div class="metric-target ${avgMetric(keywords, 'frr') < 0.05 ? 'pass' : 'warn'}">
          target: &gt; 95%
        </div>
      </div>
    </div>

    <h3 class="section-title">Per-Keyword Metrics</h3>
    <div class="keyword-table-wrap">
      <table class="keyword-table">
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Threshold</th>
            <th>TP</th>
            <th>FP</th>
            <th>FN</th>
            <th>FAR</th>
            <th>FRR</th>
            <th>FP/hr</th>
            <th>Precision</th>
            <th>Recall</th>
            <th>F1</th>
            <th>Avg Lat.</th>
            <th>P95 Lat.</th>
          </tr>
        </thead>
        <tbody>
          ${keywords.map(kw => {
            const m = report.perKeyword[kw];
            return `<tr>
              <td><span class="kw-badge kw-${kw}">${kw}</span></td>
              <td>${m.threshold}</td>
              <td>${m.truePositives}</td>
              <td>${m.falsePositives}</td>
              <td>${m.falseNegatives}</td>
              <td>${(m.far * 100).toFixed(2)}%</td>
              <td class="${m.frr > 0.05 ? 'cell-warn' : ''}">${(m.frr * 100).toFixed(1)}%</td>
              <td class="${m.fpPerHour > 0.5 ? 'cell-warn' : 'cell-pass'}">${m.fpPerHour.toFixed(2)}</td>
              <td>${(m.precision * 100).toFixed(1)}%</td>
              <td>${(m.recall * 100).toFixed(1)}%</td>
              <td>${m.f1.toFixed(3)}</td>
              <td>${m.avgLatencyMs}ms</td>
              <td>${m.p95LatencyMs}ms</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function avgMetric(keywords: string[], key: keyof KeywordMetrics): number {
  const report = getReport();
  const vals = keywords.map(kw => (report.perKeyword[kw]?.[key] as number) ?? 0);
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function renderCharts(): void {
  const report = getReport();
  const curves = Object.keys(liveCurves).length > 0 ? liveCurves : report.curves;

  requestAnimationFrame(() => {
    const detCanvas = document.getElementById('chart-det') as HTMLCanvasElement;
    const rocCanvas = document.getElementById('chart-roc') as HTMLCanvasElement;
    const cmCanvas = document.getElementById('chart-cm') as HTMLCanvasElement;
    const latCanvas = document.getElementById('chart-latency') as HTMLCanvasElement;
    const summaryCanvas = document.getElementById('chart-summary') as HTMLCanvasElement;
    const sweepCanvas = document.getElementById('chart-sweep') as HTMLCanvasElement;

    if (detCanvas) drawDETCurve(detCanvas, curves);
    if (rocCanvas) drawROCCurve(rocCanvas, curves);
    if (cmCanvas) drawConfusionMatrix(cmCanvas, report.confusionMatrix);
    if (latCanvas) drawLatencyChart(latCanvas, report.perKeyword);
    if (summaryCanvas) drawSummaryBars(summaryCanvas, report.perKeyword);
    if (sweepCanvas) drawThresholdSweep(sweepCanvas, curves, thresholdKeyword, thresholdValue);
  });
}

function renderBenchHistory(): void {
  const container = document.getElementById('bench-history')!;
  container.innerHTML = `
    <h3 class="section-title">Benchmark History</h3>
    <table class="keyword-table">
      <thead>
        <tr><th>Run</th><th>Date</th><th>Avg FP/hr</th><th>Avg Recall</th><th>Trend</th></tr>
      </thead>
      <tbody>
        ${MOCK_HISTORY.map((h, i) => `
          <tr class="${i === 0 ? 'row-current' : ''}">
            <td>${h.id}</td>
            <td>${h.date}</td>
            <td class="${h.fpPerHour < 0.5 ? 'cell-pass' : 'cell-warn'}">${h.fpPerHour.toFixed(2)}</td>
            <td>${(h.avgRecall * 100).toFixed(1)}%</td>
            <td>${i === 0 ? '← current' : i < MOCK_HISTORY.length - 1
              ? (MOCK_HISTORY[i].fpPerHour < MOCK_HISTORY[i + 1].fpPerHour ? '↑ improved' : '↓ regressed')
              : 'baseline'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderRunEvalButton(): void {
  const container = document.getElementById('bench-history')!;
  const backendUp = backendStatus != null;
  container.insertAdjacentHTML('beforeend', `
    <div class="form-actions" style="margin-top:16px">
      <button id="btn-run-eval" class="btn btn-primary" ${!backendUp ? 'disabled title="Start the backend server first"' : ''}>
        Run Live Evaluation
      </button>
      <button id="btn-run-sweep" class="btn btn-secondary" ${!backendUp ? 'disabled title="Start the backend server first"' : ''}>
        Run Threshold Sweep
      </button>
      ${!backendUp ? '<span style="font-size:12px;color:var(--text-muted);margin-left:8px">Backend offline — showing mock data</span>' : ''}
    </div>
  `);

  document.getElementById('btn-run-eval')?.addEventListener('click', runLiveEval);
  document.getElementById('btn-run-sweep')?.addEventListener('click', runLiveSweep);
}

async function runLiveEval(): Promise<void> {
  const btn = document.getElementById('btn-run-eval') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running evaluation...';
  showToast('Running KWS evaluation against silence + noise + positive clips...');

  const result = await api.runQuickEval(thresholdValue);
  if (!result) {
    showToast('Evaluation failed — check backend logs');
    btn.disabled = false;
    btn.textContent = 'Run Live Evaluation';
    return;
  }

  // Convert API result to BenchmarkReport format
  const keywords = result.keywords_evaluated;
  const perKeyword: Record<string, KeywordMetrics> = {};
  for (const kw of keywords) {
    const r = result.per_keyword[kw];
    if (!r) continue;
    perKeyword[kw] = {
      keyword: kw,
      threshold: r.threshold,
      truePositives: r.true_positives,
      falsePositives: r.silence_fps + r.noise_fps,
      falseNegatives: r.false_negatives,
      trueNegatives: 0,
      far: r.far,
      frr: r.frr,
      fpPerHour: r.fp_per_hour,
      precision: r.precision,
      recall: r.recall,
      f1: r.f1,
      avgLatencyMs: r.avg_latency_ms,
      p95LatencyMs: r.p95_latency_ms,
    };
  }

  const testSecs = result.test_audio.silence_seconds + result.test_audio.noise_seconds;
  liveReport = {
    id: `eval-${Date.now()}`,
    createdAt: new Date().toISOString(),
    modelName: 'voicepage-kws',
    modelVersion: (backendStatus?.models.keywords.length ?? 0) + ' keywords',
    keywords,
    totalClips: Object.values(result.per_keyword).reduce((sum, r) => sum + r.positive_clips_tested, 0) + 2,
    totalDurationHours: Math.round(testSecs / 36) / 100,
    perKeyword,
    curves: MOCK_REPORT.curves, // keep mock curves until sweep is run
    confusionMatrix: MOCK_REPORT.confusionMatrix,
  };
  useRealData = true;

  showToast('Evaluation complete — showing live results');
  btn.disabled = false;
  btn.textContent = 'Run Live Evaluation';
  renderBenchmarks();
}

async function runLiveSweep(): Promise<void> {
  const btn = document.getElementById('btn-run-sweep') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running threshold sweep...';

  const keywords = backendStatus?.models.keywords ?? ['open'];
  showToast(`Running threshold sweep for ${keywords.length} keywords...`);

  for (const kw of keywords) {
    const result = await api.runThresholdSweep(kw);
    if (result?.points) {
      liveCurves[kw] = result.points;
    }
  }

  showToast('Sweep complete — charts updated with real curves');
  btn.disabled = false;
  btn.textContent = 'Run Threshold Sweep';
  renderCharts();
}

// ── Threshold sweep interactivity ────────────────────────────────

function initThresholdControls(): void {
  const select = document.getElementById('sweep-keyword') as HTMLSelectElement;
  const slider = document.getElementById('sweep-threshold') as HTMLInputElement;
  const label = document.getElementById('sweep-value')!;

  select?.addEventListener('change', () => {
    thresholdKeyword = select.value;
    renderCharts();
  });

  slider?.addEventListener('input', () => {
    thresholdValue = parseFloat(slider.value);
    label.textContent = thresholdValue.toFixed(2);
    // Only redraw sweep chart for perf
    const report = getReport();
    const curves = Object.keys(liveCurves).length > 0 ? liveCurves : report.curves;
    const sweepCanvas = document.getElementById('chart-sweep') as HTMLCanvasElement;
    if (sweepCanvas) drawThresholdSweep(sweepCanvas, curves, thresholdKeyword, thresholdValue);
  });
}

// ── Training Tab ─────────────────────────────────────────────────

async function renderTraining(): Promise<void> {
  // Try to fetch real jobs from backend
  if (backendStatus) {
    liveJobs = await api.fetchJobs();
  }
  renderJobList();
  renderNewJobForm();
  renderWorkerList();
}

function renderJobList(): void {
  const container = document.getElementById('job-list')!;

  // Merge live API jobs with local mock jobs
  type AnyJob = { id: string; config: any; status: string; createdAt?: string; created_at?: number; startedAt?: string; started_at?: number | null; completedAt?: string; completed_at?: number | null; progress: number; currentStep?: string; current_step?: string; logs: string[]; metrics?: any; error?: string | null };
  const allJobs: AnyJob[] = liveJobs.length > 0
    ? [...liveJobs as AnyJob[], ...jobs as AnyJob[]]
    : [...jobs as AnyJob[]];

  if (allJobs.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No training jobs yet. Launch one below.</p>';
    return;
  }

  container.innerHTML = allJobs.map(job => {
    const kw = job.config.keyword ?? job.config.config_template ?? '?';
    const status = job.status;
    const template = job.config.configTemplate ?? job.config.config_template ?? '?';
    const worker = job.config.workerTarget ?? job.config.worker_target ?? 'local';
    const created = job.createdAt
      ? new Date(job.createdAt).toLocaleDateString()
      : job.created_at
        ? new Date(job.created_at * 1000).toLocaleDateString()
        : '?';
    const step = job.currentStep ?? job.current_step ?? '';
    const err = job.error ?? null;
    const metrics = job.metrics;

    return `
    <div class="job-card job-${status}">
      <div class="job-header">
        <div class="job-title">
          <span class="kw-badge kw-${kw}">${kw}</span>
          <span class="job-id">${job.id}</span>
          <span class="job-status-badge status-${status}">${status}</span>
        </div>
        <div class="job-meta">
          <span>Template: ${template}</span>
          <span>Worker: ${worker}</span>
          <span>Created: ${created}</span>
        </div>
      </div>

      ${status === 'training' || status === 'generating' || status === 'augmenting' ? `
        <div class="job-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${job.progress}%"></div>
          </div>
          <span class="progress-text">${job.progress}%</span>
        </div>
        ${step ? `<div class="job-step">${step}</div>` : ''}
      ` : ''}

      ${metrics ? `
        <div class="job-metrics">
          ${metrics.fpPerHour != null || metrics.fp_per_hour != null ? `<span class="mini-metric">FP/hr: <b>${metrics.fpPerHour ?? metrics.fp_per_hour}</b></span>` : ''}
          ${metrics.recall != null ? `<span class="mini-metric">Recall: <b>${(metrics.recall * 100).toFixed(1)}%</b></span>` : ''}
          ${metrics.precision != null ? `<span class="mini-metric">Precision: <b>${(metrics.precision * 100).toFixed(1)}%</b></span>` : ''}
          ${metrics.avgLatencyMs != null || metrics.avg_latency_ms != null ? `<span class="mini-metric">Latency: <b>${metrics.avgLatencyMs ?? metrics.avg_latency_ms}ms</b></span>` : ''}
        </div>
      ` : ''}

      ${err ? `<div class="job-error">${err}</div>` : ''}

      <details class="job-logs-toggle">
        <summary>Logs (${job.logs.length})</summary>
        <pre class="job-logs">${job.logs.join('\n')}</pre>
      </details>
    </div>
  `;}).join('');
}

function renderNewJobForm(): void {
  const form = document.getElementById('new-job-form')!;
  const backendUp = backendStatus != null;
  form.innerHTML = `
    <h3 class="section-title">Launch New Training Job</h3>
    ${!backendUp ? '<p class="help-text">Backend offline — jobs will be simulated locally. Start the backend to run real training.</p>' : ''}
    <div class="form-grid">
      <div class="form-group">
        <label for="job-keyword">Keyword</label>
        <select id="job-keyword">
          <option value="open">open</option>
          <option value="click">click</option>
          <option value="stop">stop</option>
          <option value="cancel">cancel</option>
          <option value="help">help</option>
        </select>
      </div>
      <div class="form-group">
        <label for="job-template">Config Template</label>
        <select id="job-template">
          <option value="full">Full (5000 samples, 50k steps)</option>
          <option value="minimal">Minimal (200 samples, 500 steps)</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div class="form-group">
        <label for="job-worker">Target Worker</label>
        <select id="job-worker">
          <option value="local">Local (this machine)</option>
          ${MOCK_WORKERS.filter(w => w.id !== 'local').map(w => `
            <option value="${w.id}" ${w.status === 'offline' ? 'disabled' : ''}>
              ${w.name} (${w.status}) ${w.gpuInfo ? '— ' + w.gpuInfo : ''}
            </option>
          `).join('')}
        </select>
      </div>
    </div>

    <div id="custom-params" class="custom-params" style="display:none">
      <h4>Custom Parameters</h4>
      <div class="form-grid form-grid--dense">
        <div class="form-group">
          <label for="param-samples">n_samples</label>
          <input id="param-samples" type="number" value="5000" min="100" step="100" />
        </div>
        <div class="form-group">
          <label for="param-val-samples">n_samples_val</label>
          <input id="param-val-samples" type="number" value="1000" min="50" step="50" />
        </div>
        <div class="form-group">
          <label for="param-steps">steps</label>
          <input id="param-steps" type="number" value="50000" min="100" step="1000" />
        </div>
        <div class="form-group">
          <label for="param-model-type">model_type</label>
          <select id="param-model-type">
            <option value="dnn">DNN</option>
            <option value="rnn">RNN</option>
          </select>
        </div>
        <div class="form-group">
          <label for="param-layer-size">layer_size</label>
          <select id="param-layer-size">
            <option value="32">32</option>
            <option value="64">64</option>
            <option value="128">128</option>
          </select>
        </div>
        <div class="form-group">
          <label for="param-aug-rounds">augmentation_rounds</label>
          <input id="param-aug-rounds" type="number" value="1" min="1" max="5" />
        </div>
        <div class="form-group">
          <label for="param-neg-weight">max_negative_weight</label>
          <input id="param-neg-weight" type="number" value="1500" min="100" step="100" />
        </div>
        <div class="form-group">
          <label for="param-target-fp">target_fp_per_hour</label>
          <input id="param-target-fp" type="number" value="0.5" min="0.1" step="0.1" />
        </div>
        <div class="form-group form-group--wide">
          <label for="param-negatives">custom_negative_phrases (comma-separated)</label>
          <input id="param-negatives" type="text" placeholder="often, oven, over, opinion" />
        </div>
      </div>
    </div>

    <div class="form-actions">
      <button id="btn-launch-job" class="btn btn-primary">Launch Job</button>
      <button id="btn-launch-all" class="btn btn-secondary">Train All Keywords</button>
    </div>
  `;

  // Toggle custom params visibility
  const templateSelect = document.getElementById('job-template') as HTMLSelectElement;
  templateSelect.addEventListener('change', () => {
    const customDiv = document.getElementById('custom-params')!;
    customDiv.style.display = templateSelect.value === 'custom' ? 'block' : 'none';
  });

  // Launch button
  document.getElementById('btn-launch-job')!.addEventListener('click', () => {
    launchJob();
  });

  document.getElementById('btn-launch-all')!.addEventListener('click', () => {
    for (const kw of ['open', 'click', 'stop', 'cancel', 'help']) {
      launchJobForKeyword(kw);
    }
  });
}

async function launchJob(): Promise<void> {
  const keyword = (document.getElementById('job-keyword') as HTMLSelectElement).value;
  await launchJobForKeyword(keyword);
}

async function launchJobForKeyword(keyword: string): Promise<void> {
  const template = (document.getElementById('job-template') as HTMLSelectElement).value as 'full' | 'minimal' | 'custom';
  const worker = (document.getElementById('job-worker') as HTMLSelectElement).value;

  const overrides: Partial<TrainingParams> = {};
  if (template === 'custom') {
    overrides.n_samples = parseInt((document.getElementById('param-samples') as HTMLInputElement).value);
    overrides.n_samples_val = parseInt((document.getElementById('param-val-samples') as HTMLInputElement).value);
    overrides.steps = parseInt((document.getElementById('param-steps') as HTMLInputElement).value);
    overrides.model_type = (document.getElementById('param-model-type') as HTMLSelectElement).value as 'dnn' | 'rnn';
    overrides.layer_size = parseInt((document.getElementById('param-layer-size') as HTMLSelectElement).value);
    overrides.augmentation_rounds = parseInt((document.getElementById('param-aug-rounds') as HTMLInputElement).value);
    overrides.max_negative_weight = parseInt((document.getElementById('param-neg-weight') as HTMLInputElement).value);
    overrides.target_false_positives_per_hour = parseFloat((document.getElementById('param-target-fp') as HTMLInputElement).value);
    const negs = (document.getElementById('param-negatives') as HTMLInputElement).value;
    if (negs) overrides.custom_negative_phrases = negs.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Try real backend first
  if (backendStatus) {
    const result = await api.launchJob(keyword, template, worker, template === 'custom' ? overrides : undefined);
    if (result) {
      showToast(`Job ${result.id} launched for "${keyword}" on ${worker}`);
      liveJobs = await api.fetchJobs();
      renderJobList();
      // Poll for updates
      pollJobUpdates(result.id);
      return;
    }
    showToast('Failed to launch job on backend — falling back to local simulation');
  }

  // Fallback: local mock simulation
  const newJob: TrainingJob = {
    id: `job-${String(Date.now()).slice(-6)}`,
    config: {
      keyword,
      configTemplate: template,
      overrides,
      workerTarget: worker,
    },
    status: 'queued',
    createdAt: new Date().toISOString(),
    progress: 0,
    logs: [`[${new Date().toLocaleTimeString()}] Job queued for "${keyword}" on ${worker}`],
  };

  jobs = [newJob, ...jobs];
  renderJobList();
  showToast(`Job ${newJob.id} queued for "${keyword}" (simulated)`);
  simulateJobProgress(newJob.id);
}

function pollJobUpdates(jobId: string): void {
  const interval = setInterval(async () => {
    const job = await api.fetchJob(jobId);
    if (!job) { clearInterval(interval); return; }
    // Update the live jobs list
    const idx = liveJobs.findIndex(j => j.id === jobId);
    if (idx >= 0) liveJobs[idx] = job;
    else liveJobs.unshift(job);
    renderJobList();
    if (job.status === 'done' || job.status === 'failed') {
      clearInterval(interval);
      showToast(`Job ${jobId}: ${job.status}`);
    }
  }, 3000);
}

function simulateJobProgress(jobId: string): void {
  const stages: JobStatus[] = ['generating', 'augmenting', 'training', 'exporting', 'evaluating', 'done'];
  let stageIdx = 0;
  let progress = 0;

  const interval = setInterval(() => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) { clearInterval(interval); return; }

    if (stageIdx < stages.length) {
      job.status = stages[stageIdx];
      if (job.status === 'training') {
        progress = Math.min(progress + 8, 95);
        job.progress = progress;
        job.currentStep = `Step ${Math.floor(progress * 500)}/${job.config.overrides.steps ?? 50000}`;
      } else if (job.status === 'done') {
        job.progress = 100;
        job.completedAt = new Date().toISOString();
        job.metrics = { fpPerHour: 0.4, recall: 0.94, precision: 0.96, avgLatencyMs: 140 };
        clearInterval(interval);
      } else {
        job.progress = Math.min(progress + 15, 100);
        stageIdx++;
      }

      if (job.status !== 'training') stageIdx++;
      job.logs.push(`[${new Date().toLocaleTimeString()}] ${job.status}`);
      renderJobList();
    }
  }, 2000);
}

function renderWorkerList(): void {
  const container = document.getElementById('worker-list')!;
  const backendUp = backendStatus != null;

  container.innerHTML = `
    <h3 class="section-title">Workers</h3>
    <div class="worker-grid">
      <div class="worker-card worker-${backendUp ? 'online' : 'offline'}">
        <div class="worker-status-dot status-${backendUp ? 'online' : 'offline'}"></div>
        <div class="worker-info">
          <div class="worker-name">Local (this machine)</div>
          <div class="worker-host">localhost:8787</div>
          <div class="worker-gpu">${backendUp ? 'Backend connected' : 'Backend offline'}</div>
          ${backendUp && backendStatus ? `
            <div class="worker-job" style="color:var(--text-secondary)">
              Models: ${backendStatus.models.keywords.join(', ') || 'none'}<br>
              Data: ${backendStatus.data.rirs} RIRs, ${backendStatus.data.background_clips} bg clips
            </div>
          ` : ''}
        </div>
      </div>
      ${MOCK_WORKERS.filter(w => w.id !== 'local').map(w => `
        <div class="worker-card worker-${w.status}">
          <div class="worker-status-dot status-${w.status}"></div>
          <div class="worker-info">
            <div class="worker-name">${w.name}</div>
            <div class="worker-host">${w.host}</div>
            ${w.gpuInfo ? `<div class="worker-gpu">${w.gpuInfo}</div>` : ''}
            ${w.currentJob ? `<div class="worker-job">Running: ${w.currentJob}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Datasets Tab ─────────────────────────────────────────────────

async function renderDatasets(): Promise<void> {
  const container = document.getElementById('dataset-content')!;

  // Try real API first
  if (backendStatus && !liveDatasets) {
    container.innerHTML = '<p style="color:var(--text-secondary)">Scanning filesystem...</p>';
    liveDatasets = await api.fetchDatasets();
  }

  // Normalize data shape to a common format
  const isLive = liveDatasets != null;
  const totalSize = isLive ? liveDatasets!.total_size_bytes : MOCK_DATASET_SUMMARY.totalSizeBytes;
  const totalFiles = isLive ? liveDatasets!.total_files : MOCK_DATASET_SUMMARY.totalFiles;
  const perKw: Record<string, { positive: number; augmented: number; sizeBytes: number }> = {};

  if (isLive) {
    for (const [kw, d] of Object.entries(liveDatasets!.per_keyword)) {
      perKw[kw] = { positive: d.positive, augmented: d.augmented, sizeBytes: d.size_bytes };
    }
  } else {
    for (const [kw, d] of Object.entries(MOCK_DATASET_SUMMARY.perKeyword)) {
      perKw[kw] = d;
    }
  }

  const shared = isLive
    ? { rirs: liveDatasets!.shared.rirs, backgroundClips: liveDatasets!.shared.background_clips, featureFiles: liveDatasets!.shared.feature_files, sharedSizeBytes: liveDatasets!.shared.shared_size_bytes }
    : MOCK_DATASET_SUMMARY.shared;

  const modeLabel = isLive
    ? '<span class="data-badge data-live">Live Filesystem Scan</span>'
    : '<span class="data-badge data-mock">Mock Data — start backend for real stats</span>';

  container.innerHTML = `
    <div class="data-mode">${modeLabel}</div>
    <div class="metrics-overview">
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${formatBytes(totalSize)}</div>
        <div class="metric-label">Total Disk Usage</div>
      </div>
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${totalFiles.toLocaleString()}</div>
        <div class="metric-label">Total Files</div>
      </div>
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${Object.keys(perKw).length}</div>
        <div class="metric-label">Keywords</div>
      </div>
      <div class="metric-card metric-card--hero">
        <div class="metric-value">${shared.rirs + shared.backgroundClips}</div>
        <div class="metric-label">Shared Assets</div>
      </div>
    </div>

    <h3 class="section-title">Per-Keyword Datasets</h3>
    <div class="dataset-grid">
      ${Object.entries(perKw).map(([kw, data]) => `
        <div class="dataset-card">
          <div class="dataset-header">
            <span class="kw-badge kw-${kw}">${kw}</span>
            <span class="dataset-size">${formatBytes(data.sizeBytes)}</span>
          </div>
          <div class="dataset-stats">
            <div class="dataset-stat">
              <span class="stat-value">${data.positive.toLocaleString()}</span>
              <span class="stat-label">Positive clips</span>
            </div>
            <div class="dataset-stat">
              <span class="stat-value">${data.augmented.toLocaleString()}</span>
              <span class="stat-label">Augmented clips</span>
            </div>
          </div>
          <div class="dataset-bar">
            <div class="dataset-bar-fill" style="width: ${totalSize > 0 ? (data.sizeBytes / totalSize * 100).toFixed(0) : 0}%"></div>
          </div>
          <div class="dataset-actions">
            <button class="btn btn-small btn-secondary" data-action="regen" data-kw="${kw}">Regenerate</button>
            <button class="btn btn-small btn-danger" data-action="delete" data-kw="${kw}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>

    <h3 class="section-title">Shared Data</h3>
    <div class="shared-data-grid">
      <div class="shared-card">
        <div class="shared-icon">🏠</div>
        <div class="shared-info">
          <div class="shared-name">Room Impulse Responses</div>
          <div class="shared-count">${shared.rirs} files</div>
        </div>
      </div>
      <div class="shared-card">
        <div class="shared-icon">🔊</div>
        <div class="shared-info">
          <div class="shared-name">Background Clips</div>
          <div class="shared-count">${shared.backgroundClips} files</div>
        </div>
      </div>
      <div class="shared-card">
        <div class="shared-icon">📊</div>
        <div class="shared-info">
          <div class="shared-name">Feature Files</div>
          <div class="shared-count">${shared.featureFiles} files (${formatBytes(shared.sharedSizeBytes)})</div>
        </div>
      </div>
    </div>

    <div class="dataset-footer">
      <h3 class="section-title">Disk Management</h3>
      <p class="help-text">
        Training generates a lot of synthetic data. Use these tools to manage disk usage.
        Shared data (RIRs, backgrounds, features) is reused across all keywords.
      </p>
      <div class="form-actions">
        <button id="btn-refresh-datasets" class="btn btn-secondary">Refresh Stats</button>
        <button class="btn btn-danger" onclick="alert('Would delete all augmented clips (keeping originals)')">Clean Augmented</button>
        <button class="btn btn-danger" onclick="alert('Would delete ALL training data (requires re-download)')">Purge All Data</button>
      </div>
    </div>
  `;

  // Wire up per-keyword buttons
  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kw = (btn as HTMLElement).dataset.kw!;
      if (!confirm(`Delete all training data for "${kw}"?\nThis cannot be undone.`)) return;
      if (backendStatus) {
        const ok = await api.deleteDataset(kw);
        showToast(ok ? `Deleted dataset for "${kw}"` : `Failed to delete "${kw}"`);
        liveDatasets = null; // force rescan
      } else {
        showToast(`Deleted dataset for "${kw}" (simulated)`);
      }
      renderDatasets();
    });
  });

  container.querySelectorAll('[data-action="regen"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kw = (btn as HTMLElement).dataset.kw!;
      if (backendStatus) {
        showToast(`Launching regeneration job for "${kw}"...`);
        await launchJobForKeyword(kw);
      } else {
        showToast(`Would regenerate "${kw}" dataset (backend offline)`);
      }
    });
  });

  document.getElementById('btn-refresh-datasets')?.addEventListener('click', async () => {
    liveDatasets = null;
    renderDatasets();
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// ── Toast Notification ───────────────────────────────────────────

function showToast(message: string): void {
  const area = document.getElementById('toast-area')!;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  area.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Resize handler ───────────────────────────────────────────────

let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (activeTab === 'benchmarks') renderCharts();
  }, 200);
});

// ── Backend probe ────────────────────────────────────────────────

async function probeBackend(): Promise<void> {
  backendStatus = await api.fetchStatus();
  if (backendStatus) {
    console.log('[bench] Backend connected:', backendStatus);
    showToast('Backend connected — live data available');
  } else {
    console.log('[bench] Backend offline — using mock data');
  }
}

// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initThresholdControls();

  // Probe backend before rendering
  await probeBackend();

  switchTab('benchmarks');
});
