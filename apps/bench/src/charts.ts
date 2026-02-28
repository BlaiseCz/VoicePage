import type { CurvePoint, KeywordMetrics, ConfusionMatrix } from './types.js';

// ── Color palette ────────────────────────────────────────────────

const KEYWORD_COLORS: Record<string, string> = {
  open: '#4ecca3',
  click: '#45b7d1',
  stop: '#f7768e',
  cancel: '#ff9e64',
  help: '#bb9af7',
};

const GRID_COLOR = 'rgba(255,255,255,0.06)';
const AXIS_COLOR = 'rgba(255,255,255,0.2)';
const TEXT_COLOR = '#888';
const LABEL_FONT = '11px system-ui, sans-serif';
const TITLE_FONT = '13px system-ui, sans-serif';

function getColor(keyword: string): string {
  return KEYWORD_COLORS[keyword] ?? '#888';
}

// ── Canvas helpers ───────────────────────────────────────────────

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return ctx;
}

interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

function getPlotArea(canvas: HTMLCanvasElement, margin = { top: 35, right: 20, bottom: 45, left: 55 }): PlotArea {
  const rect = canvas.getBoundingClientRect();
  return {
    left: margin.left,
    top: margin.top,
    width: rect.width - margin.left - margin.right,
    height: rect.height - margin.top - margin.bottom,
    right: rect.width - margin.right,
    bottom: rect.height - margin.bottom,
  };
}

function drawGrid(ctx: CanvasRenderingContext2D, area: PlotArea, xTicks: number, yTicks: number): void {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= xTicks; i++) {
    const x = area.left + (area.width * i) / xTicks;
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
  }
  for (let i = 0; i <= yTicks; i++) {
    const y = area.top + (area.height * i) / yTicks;
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, area: PlotArea): void {
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, area.top);
  ctx.lineTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.bottom);
  ctx.stroke();
}

function drawTitle(ctx: CanvasRenderingContext2D, area: PlotArea, title: string): void {
  ctx.fillStyle = '#ccc';
  ctx.font = TITLE_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(title, area.left + area.width / 2, area.top - 12);
}

function drawAxisLabels(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  xLabel: string,
  yLabel: string,
  xTicks: number,
  yTicks: number,
  xFormat: (v: number) => string,
  yFormat: (v: number) => string,
): void {
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';

  // X axis labels
  for (let i = 0; i <= xTicks; i++) {
    const x = area.left + (area.width * i) / xTicks;
    const val = i / xTicks;
    ctx.fillText(xFormat(val), x, area.bottom + 16);
  }
  ctx.fillText(xLabel, area.left + area.width / 2, area.bottom + 35);

  // Y axis labels
  ctx.textAlign = 'right';
  for (let i = 0; i <= yTicks; i++) {
    const y = area.top + (area.height * i) / yTicks;
    const val = 1 - i / yTicks;
    ctx.fillText(yFormat(val), area.left - 8, y + 4);
  }
  ctx.save();
  ctx.translate(12, area.top + area.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

// ── DET Curve (Detection Error Tradeoff) ─────────────────────────

export function drawDETCurve(
  canvas: HTMLCanvasElement,
  curves: Record<string, CurvePoint[]>,
): void {
  const ctx = setupCanvas(canvas);
  const area = getPlotArea(canvas);

  drawGrid(ctx, area, 5, 5);
  drawAxes(ctx, area);
  drawTitle(ctx, area, 'DET Curve — Detection Error Tradeoff');
  drawAxisLabels(ctx, area, 'False Accept Rate (FAR)', 'False Reject Rate (FRR)', 5, 5,
    (v) => (v * 100).toFixed(0) + '%',
    (v) => (v * 100).toFixed(0) + '%',
  );

  // Draw curves
  for (const [keyword, points] of Object.entries(curves)) {
    ctx.strokeStyle = getColor(keyword);
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      const x = area.left + p.far * area.width;
      const y = area.bottom - p.frr * area.height;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // Legend
  drawLegend(ctx, area, Object.keys(curves));
}

// ── ROC Curve ────────────────────────────────────────────────────

export function drawROCCurve(
  canvas: HTMLCanvasElement,
  curves: Record<string, CurvePoint[]>,
): void {
  const ctx = setupCanvas(canvas);
  const area = getPlotArea(canvas);

  drawGrid(ctx, area, 5, 5);
  drawAxes(ctx, area);
  drawTitle(ctx, area, 'ROC Curve — Receiver Operating Characteristic');
  drawAxisLabels(ctx, area, 'False Positive Rate (FPR)', 'True Positive Rate (TPR)', 5, 5,
    (v) => (v * 100).toFixed(0) + '%',
    (v) => (v * 100).toFixed(0) + '%',
  );

  // Diagonal (random classifier)
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.top);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw curves
  for (const [keyword, points] of Object.entries(curves)) {
    ctx.strokeStyle = getColor(keyword);
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      const x = area.left + p.fpr * area.width;
      const y = area.bottom - p.tpr * area.height;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  drawLegend(ctx, area, Object.keys(curves));
}

// ── Confusion Matrix Heatmap ─────────────────────────────────────

export function drawConfusionMatrix(
  canvas: HTMLCanvasElement,
  cm: ConfusionMatrix,
): void {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const margin = { top: 45, right: 20, bottom: 20, left: 70 };
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;
  const n = cm.labels.length;
  const cellW = plotW / n;
  const cellH = plotH / n;

  // Title
  ctx.fillStyle = '#ccc';
  ctx.font = TITLE_FONT;
  ctx.textAlign = 'center';
  ctx.fillText('Confusion Matrix (Actual → Predicted)', rect.width / 2, 20);

  // Find max for color scaling (exclude diagonal)
  let maxOff = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && cm.matrix[i][j] > maxOff) maxOff = cm.matrix[i][j];
    }
  }

  // Draw cells
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const val = cm.matrix[i][j];
      const x = margin.left + j * cellW;
      const y = margin.top + i * cellH;

      if (i === j) {
        // Diagonal — true positives (green scale)
        const rowSum = cm.matrix[i].reduce((a, b) => a + b, 0);
        const pct = rowSum > 0 ? val / rowSum : 0;
        ctx.fillStyle = `rgba(78, 204, 163, ${0.15 + pct * 0.7})`;
      } else {
        // Off-diagonal — errors (red scale)
        const intensity = maxOff > 0 ? val / maxOff : 0;
        ctx.fillStyle = `rgba(247, 118, 142, ${intensity * 0.7})`;
      }

      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);

      // Value text
      ctx.fillStyle = val > 0 ? '#e0e0e0' : '#444';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(val), x + cellW / 2, y + cellH / 2 + 4);
    }
  }

  // Row labels (actual)
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'right';
  for (let i = 0; i < n; i++) {
    ctx.fillText(cm.labels[i], margin.left - 8, margin.top + i * cellH + cellH / 2 + 4);
  }

  // Column labels (predicted)
  ctx.textAlign = 'center';
  for (let j = 0; j < n; j++) {
    ctx.fillText(cm.labels[j], margin.left + j * cellW + cellW / 2, margin.top - 6);
  }
}

// ── Latency Distribution (bar chart) ─────────────────────────────

export function drawLatencyChart(
  canvas: HTMLCanvasElement,
  perKeyword: Record<string, KeywordMetrics>,
): void {
  const ctx = setupCanvas(canvas);
  const area = getPlotArea(canvas, { top: 35, right: 20, bottom: 55, left: 55 });
  const keywords = Object.keys(perKeyword);
  const n = keywords.length;
  const barGroupW = area.width / n;
  const barW = barGroupW * 0.3;
  const gap = barGroupW * 0.05;

  const maxLatency = Math.max(...keywords.map(k => perKeyword[k].p95LatencyMs)) * 1.2;

  drawGrid(ctx, area, n, 5);
  drawAxes(ctx, area);
  drawTitle(ctx, area, 'Detection Latency (ms)');

  // Y axis labels
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = area.top + (area.height * i) / 5;
    const val = maxLatency * (1 - i / 5);
    ctx.fillText(Math.round(val) + 'ms', area.left - 8, y + 4);
  }

  // Bars
  keywords.forEach((kw, idx) => {
    const m = perKeyword[kw];
    const x = area.left + idx * barGroupW + barGroupW * 0.15;

    // Avg bar
    const avgH = (m.avgLatencyMs / maxLatency) * area.height;
    ctx.fillStyle = getColor(kw);
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, area.bottom - avgH, barW, avgH);

    // P95 bar
    const p95H = (m.p95LatencyMs / maxLatency) * area.height;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(x + barW + gap, area.bottom - p95H, barW, p95H);
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.fillText(kw, area.left + idx * barGroupW + barGroupW / 2, area.bottom + 16);
    ctx.fillStyle = '#666';
    ctx.fillText(`${m.avgLatencyMs}/${m.p95LatencyMs}`, area.left + idx * barGroupW + barGroupW / 2, area.bottom + 30);
  });

  // Sub-label
  ctx.fillStyle = '#555';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('avg / p95', area.left + area.width / 2, area.bottom + 42);
}

// ── FP/Hour + Recall Summary Bar Chart ───────────────────────────

export function drawSummaryBars(
  canvas: HTMLCanvasElement,
  perKeyword: Record<string, KeywordMetrics>,
): void {
  const ctx = setupCanvas(canvas);
  const area = getPlotArea(canvas, { top: 35, right: 20, bottom: 50, left: 55 });
  const keywords = Object.keys(perKeyword);
  const n = keywords.length;
  const barGroupW = area.width / n;
  const barW = barGroupW * 0.35;

  drawGrid(ctx, area, n, 5);
  drawAxes(ctx, area);
  drawTitle(ctx, area, 'FP/Hour & Recall per Keyword');

  // Target line for FP/hr < 0.5
  const targetY = area.bottom - (0.5 / 2.0) * area.height;
  ctx.strokeStyle = '#f7768e';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(area.left, targetY);
  ctx.lineTo(area.right, targetY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f7768e';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('target: 0.5 FP/hr', area.right - 90, targetY - 4);

  // Y axis (FP/hr on left, scale 0–2)
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = area.top + (area.height * i) / 5;
    const val = 2.0 * (1 - i / 5);
    ctx.fillText(val.toFixed(1), area.left - 8, y + 4);
  }

  keywords.forEach((kw, idx) => {
    const m = perKeyword[kw];
    const x = area.left + idx * barGroupW + barGroupW * 0.15;

    // FP/hr bar
    const fpH = (m.fpPerHour / 2.0) * area.height;
    ctx.fillStyle = getColor(kw);
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, area.bottom - fpH, barW, fpH);
    ctx.globalAlpha = 1;

    // Recall dot
    const recallY = area.bottom - m.recall * area.height;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + barW + 15, recallY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = getColor(kw);
    ctx.beginPath();
    ctx.arc(x + barW + 15, recallY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.fillText(kw, area.left + idx * barGroupW + barGroupW / 2, area.bottom + 16);
    ctx.fillStyle = '#666';
    ctx.fillText(`${m.fpPerHour} fp/h`, area.left + idx * barGroupW + barGroupW / 2, area.bottom + 30);
  });
}

// ── Threshold Sweep Chart (interactive) ──────────────────────────

export function drawThresholdSweep(
  canvas: HTMLCanvasElement,
  curves: Record<string, CurvePoint[]>,
  activeKeyword: string,
  currentThreshold: number,
): void {
  const ctx = setupCanvas(canvas);
  const area = getPlotArea(canvas);
  const points = curves[activeKeyword] ?? [];

  drawGrid(ctx, area, 10, 5);
  drawAxes(ctx, area);
  drawTitle(ctx, area, `Threshold Sweep — "${activeKeyword}"`);
  drawAxisLabels(ctx, area, 'Threshold', 'Rate', 10, 5,
    (v) => v.toFixed(1),
    (v) => (v * 100).toFixed(0) + '%',
  );

  // FAR line
  ctx.strokeStyle = '#f7768e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = area.left + p.threshold * area.width;
    const y = area.bottom - p.far * area.height;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // FRR line
  ctx.strokeStyle = '#45b7d1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = area.left + p.threshold * area.width;
    const y = area.bottom - p.frr * area.height;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current threshold marker
  const tx = area.left + currentThreshold * area.width;
  ctx.strokeStyle = '#4ecca3';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(tx, area.top);
  ctx.lineTo(tx, area.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#4ecca3';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`θ = ${currentThreshold.toFixed(2)}`, tx, area.top - 2);

  // Legend for FAR/FRR
  const legendX = area.right - 80;
  const legendY = area.top + 10;
  ctx.fillStyle = '#f7768e';
  ctx.fillRect(legendX, legendY, 12, 3);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.fillText('FAR', legendX + 16, legendY + 4);

  ctx.fillStyle = '#45b7d1';
  ctx.fillRect(legendX, legendY + 16, 12, 3);
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText('FRR', legendX + 16, legendY + 20);
}

// ── Shared Legend ────────────────────────────────────────────────

function drawLegend(ctx: CanvasRenderingContext2D, area: PlotArea, keywords: string[]): void {
  const legendX = area.right - 70;
  let legendY = area.top + 8;

  for (const kw of keywords) {
    ctx.fillStyle = getColor(kw);
    ctx.fillRect(legendX, legendY, 12, 3);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.fillText(kw, legendX + 16, legendY + 4);
    legendY += 16;
  }
}
