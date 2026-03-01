/**
 * Live KWS Test — standalone page for testing openWakeWord keyword spotting
 * with the pre-trained "alexa" model in real-time from the browser mic.
 *
 * Bypasses the full VoicePage engine; directly wires:
 *   mic → AudioPipeline → OwwKwsEngine → score display
 */

import { OwwKwsEngine, AudioPipeline } from 'voicepage-core';

// --- Model URLs ---
const MODEL_BASE = '/models/kws';
const WORKLET_URL = '/pcm-processor.worklet.js';

// --- DOM refs ---
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const micBtn = document.getElementById('mic-btn')!;
const micLabel = document.getElementById('mic-label')!;
const scoreBar = document.getElementById('score-bar-alexa') as HTMLDivElement;
const scoreVal = document.getElementById('score-val-alexa')!;
const thresholdSlider = document.getElementById('threshold-slider') as HTMLInputElement;
const thresholdVal = document.getElementById('threshold-val')!;
const thresholdLine = document.getElementById('threshold-line') as HTMLDivElement;
const detectionLog = document.getElementById('detection-log')!;
const detectionFlash = document.getElementById('detection-flash')!;
const fpsVal = document.getElementById('fps-val')!;
const latencyVal = document.getElementById('latency-val')!;
const statDetections = document.getElementById('stat-detections')!;
const statAvgScore = document.getElementById('stat-avg-score')!;
const statMaxScore = document.getElementById('stat-max-score')!;
const statUptime = document.getElementById('stat-uptime')!;

// Visualization canvases
const waveformCanvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
const spectrogramCanvas = document.getElementById('spectrogram-canvas') as HTMLCanvasElement;
const dbgFrames = document.getElementById('dbg-frames')!;
const dbgSrate = document.getElementById('dbg-srate')!;
const dbgRms = document.getElementById('dbg-rms')!;
const dbgPeak = document.getElementById('dbg-peak')!;
const dbgMel = document.getElementById('dbg-mel')!;
const dbgEmb = document.getElementById('dbg-emb')!;

// --- State ---
let pipeline: AudioPipeline | null = null;
let kwsEngine: OwwKwsEngine | null = null;
let unsubFrame: (() => void) | null = null;
let listening = false;
let initialized = false;
let currentThreshold = 0.5;

// Stats
let detectionCount = 0;
let detectionScores: number[] = [];
let maxScore = 0;
let startTime = 0;
let frameCount = 0;
let lastFpsUpdate = 0;
let lastFrameTime = 0;
let logInitialized = false;
let totalFrames = 0;
let lastFrame: Float32Array | null = null;

// --- Visualization setup ---
function initCanvases(): void {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [waveformCanvas, spectrogramCanvas]) {
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = c.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
  }
}

// Spectrogram image data (scrolling left)
let spectrogramCol = 0;
let spectrogramImageData: ImageData | null = null;

function drawWaveform(frame: Float32Array): void {
  const ctx = waveformCanvas.getContext('2d')!;
  const w = waveformCanvas.getBoundingClientRect().width;
  const h = waveformCanvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, w, h);

  // Center line
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Waveform
  ctx.strokeStyle = '#4ecca3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = frame.length / w;
  for (let i = 0; i < w; i++) {
    const idx = Math.floor(i * step);
    const val = frame[idx] ?? 0;
    const y = (1 - val) * h / 2;
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();
}

function drawSpectrogramColumn(frame: Float32Array): void {
  const ctx = spectrogramCanvas.getContext('2d')!;
  const w = spectrogramCanvas.getBoundingClientRect().width;
  const h = spectrogramCanvas.getBoundingClientRect().height;

  // Compute simple FFT-like power spectrum using averaging bins
  const bins = Math.floor(h);
  const spectrum = new Float32Array(bins);
  const binSize = Math.floor(frame.length / 2 / bins);

  // Simple DFT approximation: use frame magnitude in frequency-like bins
  // For a real spectrogram we'd do FFT, but for debug visualization
  // we'll compute energy in overlapping windows as a proxy
  for (let b = 0; b < bins; b++) {
    let sum = 0;
    const start = b * binSize;
    const end = Math.min(start + binSize * 2, frame.length);
    for (let i = start; i < end; i++) {
      sum += frame[i] * frame[i];
    }
    spectrum[b] = Math.sqrt(sum / (end - start));
  }

  // Scroll existing image left by 1 pixel
  const imgData = ctx.getImageData(1, 0, w - 1, h);
  ctx.putImageData(imgData, 0, 0);

  // Draw new column on the right edge
  const x = w - 1;
  for (let b = 0; b < bins; b++) {
    const val = Math.min(spectrum[b] * 15, 1); // scale for visibility
    const r = Math.floor(val * 78);
    const g = Math.floor(val * 204);
    const bv = Math.floor(val * 163);
    ctx.fillStyle = `rgb(${r},${g},${bv})`;
    // Draw bottom-up (low freq at bottom)
    ctx.fillRect(x, h - 1 - b, 1, 1);
  }
}

function onFrame(frame: Float32Array): void {
  totalFrames++;
  lastFrame = frame;

  // Draw visualization
  drawWaveform(frame);
  drawSpectrogramColumn(frame);

  // Compute RMS and peak for debug
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < frame.length; i++) {
    sumSq += frame[i] * frame[i];
    const abs = Math.abs(frame[i]);
    if (abs > peak) peak = abs;
  }
  const rms = Math.sqrt(sumSq / frame.length);

  // Update debug info (throttle to every 5th frame)
  if (totalFrames % 5 === 0) {
    dbgFrames.textContent = String(totalFrames);
    dbgRms.textContent = rms.toFixed(4);
    dbgPeak.textContent = peak.toFixed(4);

    // Read engine internal buffer sizes
    if (kwsEngine) {
      const eng = kwsEngine as any;
      dbgMel.textContent = String(eng.melBuffer?.length ?? '?');
      dbgEmb.textContent = String(eng.embeddingBuffer?.length ?? '?');
    }
  }

  // Log first frame to console for sanity
  if (totalFrames === 1) {
    console.log('[KWS-TEST] First frame received, length:', frame.length, 'sample[0..4]:', Array.from(frame.slice(0, 5)));
  }
}

// --- Threshold control ---
thresholdSlider.addEventListener('input', () => {
  currentThreshold = parseFloat(thresholdSlider.value);
  thresholdVal.textContent = currentThreshold.toFixed(2);
  thresholdLine.style.left = `${currentThreshold * 100}%`;
  // Update engine threshold live
  if (kwsEngine) {
    (kwsEngine as any).thresholds = { hey_mycroft: currentThreshold };
    (kwsEngine as any).defaultThreshold = currentThreshold;
  }
});

// --- Mic button ---
micBtn.addEventListener('click', async () => {
  if (listening) {
    stopListening();
  } else {
    await startListening();
  }
});

// --- Init & start ---
async function startListening(): Promise<void> {
  try {
    if (!initialized) {
      setStatus('loading', 'Initializing audio pipeline...');

      pipeline = new AudioPipeline(WORKLET_URL);
      await pipeline.init();

      // Show sample rate
      dbgSrate.textContent = `${pipeline.getSampleRate()} Hz`;
      console.log('[KWS-TEST] Audio pipeline initialized, sample rate:', pipeline.getSampleRate());

      initCanvases();

      setStatus('loading', 'Loading ONNX models (mel, embedding, hey_mycroft)...');

      kwsEngine = new OwwKwsEngine({
        melModelUrl: `${MODEL_BASE}/melspectrogram.onnx`,
        embeddingModelUrl: `${MODEL_BASE}/embedding_model.onnx`,
        keywordModelUrls: {
          hey_mycroft: `${MODEL_BASE}/hey_mycroft_v0.1.onnx`,
        },
        thresholds: { hey_mycroft: currentThreshold },
        onScore: (keyword, score) => {
          updateScoreDisplay(score);
          // Log every 10th score to console for debugging
          if (totalFrames % 10 === 0) {
            console.log(`[KWS-TEST] score: ${keyword}=${score.toFixed(6)}`);
          }
        },
      });

      await kwsEngine.init();
      console.log('[KWS-TEST] ONNX models loaded. Keyword sessions:', Array.from((kwsEngine as any).keywordSessions.keys()));
      initialized = true;
    }

    // Start KWS
    kwsEngine!.start((keyword: string, confidence: number) => {
      onDetection(keyword, confidence);
    });

    // Warmup: push silent frames to pre-fill mel/embedding buffers.
    // This matches the Python library's initialization behavior and must happen
    // after start() since start() clears buffers.
    setStatus('loading', 'Warming up audio pipeline...');
    const WARMUP_FRAMES = 15;
    const silentFrame = new Float32Array(1280);
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      await kwsEngine!.processFrame(silentFrame);
    }
    console.log(`[KWS-TEST] Warmup done: ${WARMUP_FRAMES} silent frames, mel=${(kwsEngine as any).melBuffer?.length}, emb=${(kwsEngine as any).embeddingBuffer?.length}`);

    // Wire audio frames → KWS + visualization
    pipeline!.start();
    unsubFrame = pipeline!.onFrame((frame) => {
      // Visualization + debug
      onFrame(frame);

      // KWS processing
      const t0 = performance.now();
      kwsEngine!.processFrame(frame).then(() => {
        const dt = performance.now() - t0;
        lastFrameTime = dt;
        frameCount++;
      });
    });
    console.log('[KWS-TEST] Frame listener wired, pipeline started');

    listening = true;
    startTime = Date.now();
    frameCount = 0;
    lastFpsUpdate = performance.now();
    micBtn.classList.add('listening');
    micLabel.textContent = 'Listening — say "Hey Mycroft"';
    setStatus('active', 'Listening for "Hey Mycroft"...');

    // Start stats update loop
    requestAnimationFrame(updateStats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus('error', `Error: ${msg}`);
    console.error('KWS init error:', err);
  }
}

function stopListening(): void {
  kwsEngine?.stop();
  unsubFrame?.();
  unsubFrame = null;
  pipeline?.stop();

  listening = false;
  micBtn.classList.remove('listening');
  micLabel.textContent = 'Click to start';
  setStatus('idle', 'Stopped. Click mic to resume.');

  // Reset score bar
  updateScoreDisplay(0);
}

// --- Score display ---
function updateScoreDisplay(score: number): void {
  const pct = Math.min(score * 100, 100);
  scoreBar.style.width = `${pct}%`;
  scoreVal.textContent = score.toFixed(3);

  // Color coding
  scoreBar.classList.remove('hot', 'detected');
  if (score >= currentThreshold) {
    scoreBar.classList.add('detected');
  } else if (score >= currentThreshold * 0.7) {
    scoreBar.classList.add('hot');
  }
}

// --- Detection handler ---
function onDetection(keyword: string, confidence: number): void {
  detectionCount++;
  detectionScores.push(confidence);
  if (confidence > maxScore) maxScore = confidence;

  // Flash
  detectionFlash.classList.remove('active');
  void detectionFlash.offsetWidth; // reflow
  detectionFlash.classList.add('active');

  // Log entry
  if (!logInitialized) {
    detectionLog.innerHTML = '';
    logInitialized = true;
  }

  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-keyword">${keyword}</span>
    <span class="log-score">${(confidence * 100).toFixed(1)}%</span>
    <span class="log-info">(threshold: ${currentThreshold.toFixed(2)})</span>
  `;
  detectionLog.appendChild(entry);
  detectionLog.scrollTop = detectionLog.scrollHeight;

  // Update stats
  statDetections.textContent = String(detectionCount);
  const avg = detectionScores.reduce((a, b) => a + b, 0) / detectionScores.length;
  statAvgScore.textContent = `${(avg * 100).toFixed(1)}%`;
  statMaxScore.textContent = `${(maxScore * 100).toFixed(1)}%`;
}

// --- Stats update loop ---
function updateStats(): void {
  if (!listening) return;

  // FPS
  const now = performance.now();
  if (now - lastFpsUpdate >= 1000) {
    fpsVal.textContent = String(frameCount);
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Latency
  latencyVal.textContent = lastFrameTime.toFixed(1);

  // Uptime
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  if (uptimeSec < 60) {
    statUptime.textContent = `${uptimeSec}s`;
  } else {
    const m = Math.floor(uptimeSec / 60);
    const s = uptimeSec % 60;
    statUptime.textContent = `${m}m ${s}s`;
  }

  requestAnimationFrame(updateStats);
}

// --- Helpers ---
function setStatus(state: 'idle' | 'loading' | 'active' | 'error', text: string): void {
  statusDot.className = 'status-dot';
  if (state === 'loading') statusDot.classList.add('loading');
  else if (state === 'active') statusDot.classList.add('active');
  else if (state === 'error') statusDot.classList.add('error');
  statusText.textContent = text;
}
