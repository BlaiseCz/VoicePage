import {
  VoicePageEngine,
  StubKwsEngine,
  StubVadEngine,
  StubAsrEngine,
  AudioPipeline,
  OwwKwsEngine,
  SileroVadEngine,
  WhisperAsrEngine,
  VoicePageEvent,
  CollisionPolicy,
  IKwsEngine,
  IVadEngine,
  IAsrEngine,
} from 'voicepage-core';
import { VoicepageOverlay } from 'voicepage-ui';
import { Tutorial } from './tutorial.js';

// --- Determine mode from URL params ---
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') ?? 'stub'; // 'stub' | 'real'
const isRealMode = mode === 'real';

// --- Model URLs (relative to public/ directory, served by Vite) ---
const MODEL_BASE = '/models/kws';
const VAD_MODEL_URL = '/models/vad/silero_vad.onnx';
const WHISPER_ENCODER_URL = '/models/whisper/whisper-tiny-encoder.onnx';
const WHISPER_DECODER_URL = '/models/whisper/whisper-tiny-decoder.onnx';
const WHISPER_TOKENIZER_URL = '/models/whisper/tokenizer.json';

let kwsEngine: IKwsEngine;
let vadEngine: IVadEngine;
let asrEngine: IAsrEngine;
let audioPipeline: AudioPipeline | undefined;

if (isRealMode) {
  // --- Real audio pipeline ---
  // Worklet URL points to the static JS file in public/
  const WORKLET_URL = '/pcm-processor.worklet.js';
  audioPipeline = new AudioPipeline(WORKLET_URL);

  kwsEngine = new OwwKwsEngine({
    melModelUrl: `${MODEL_BASE}/melspectrogram.onnx`,
    embeddingModelUrl: `${MODEL_BASE}/embedding_model.onnx`,
    keywordModelUrls: {
      open: `${MODEL_BASE}/open.onnx`,
      click: `${MODEL_BASE}/click.onnx`,
      stop: `${MODEL_BASE}/stop.onnx`,
      cancel: `${MODEL_BASE}/cancel.onnx`,
      help: `${MODEL_BASE}/help.onnx`,
    },
    thresholds: { open: 0.5, click: 0.5, stop: 0.5, cancel: 0.5, help: 0.5 },
  });

  vadEngine = new SileroVadEngine({
    modelUrl: VAD_MODEL_URL,
    silenceDurationMs: 1000,
  });

  asrEngine = new WhisperAsrEngine({
    encoderModelUrl: WHISPER_ENCODER_URL,
    decoderModelUrl: WHISPER_DECODER_URL,
    tokenizerUrl: WHISPER_TOKENIZER_URL,
    language: 'en',
    maxTokens: 64, // Short utterances for voice nav
  });
} else {
  // --- Stub engines (no mic, no models) ---
  kwsEngine = new StubKwsEngine();
  vadEngine = new StubVadEngine(500); // Short delay for demo
  asrEngine = new StubAsrEngine();
}

const engine = new VoicePageEngine(kwsEngine, vadEngine, asrEngine, {
  collisionPolicy: 'disambiguate',
  highlightMs: 400,
}, audioPipeline);

// --- Connect UI overlay ---
// Wait for the custom element to be upgraded before calling instance methods
customElements.whenDefined('voicepage-overlay').then(() => {
  const overlay = document.getElementById('vp-overlay') as VoicepageOverlay;
  overlay.connectEngine(engine);
});

// --- Event log ---
const eventLog = document.getElementById('event-log')!;
let logInitialized = false;

function addLogEntry(event: VoicePageEvent): void {
  if (!logInitialized) {
    eventLog.innerHTML = '';
    logInitialized = true;
  }

  const entry = document.createElement('div');
  entry.className = 'event-entry';

  const time = new Date(event.ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const detail = formatEventDetail(event);
  entry.innerHTML = `<span class="event-time">${time}</span> <span class="event-type">${event.type}</span> <span class="event-detail">${detail}</span>`;

  eventLog.appendChild(entry);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function formatEventDetail(event: VoicePageEvent): string {
  switch (event.type) {
    case 'ListeningChanged':
      return event.enabled ? '→ ON' : '→ OFF';
    case 'KeywordDetected':
      return `"${event.keyword}" (${((event.confidence ?? 0) * 100).toFixed(0)}%)`;
    case 'CaptureStarted':
      return `[${event.requestId}]`;
    case 'CaptureEnded':
      return `[${event.requestId}] reason=${event.reason}`;
    case 'TranscriptReady':
      return `"${event.transcript}"`;
    case 'TargetIndexBuilt':
      return `${event.targetCount} targets (${event.scope})`;
    case 'TargetResolved':
      return `→ "${event.label}" (${event.match})`;
    case 'TargetResolutionFailed':
      return `reason=${event.reason}`;
    case 'ActionProposed':
      return `${event.action} → ${event.targetId}${event.risk ? ' ⚠️ HIGH RISK' : ''}`;
    case 'ConfirmationRequired':
      return `⚠️ Confirm: ${event.action} → "${event.label}" (${event.targetId})`;
    case 'ActionExecuted':
      return event.ok ? `✓ ${event.action}` : `✗ ${event.error}`;
    case 'EngineError':
      return `[${event.code}] ${event.message}`;
    default:
      return '';
  }
}

engine.on(addLogEntry);

// --- Action feedback notifications ---
engine.on((event) => {
  if (event.type === 'ActionExecuted' && event.ok) {
    showNotification(`Executed: ${event.action} on ${event.targetId}`);
  }
});

function showNotification(message: string): void {
  const area = document.getElementById('notification-area')!;
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = message;
  area.appendChild(notif);
  setTimeout(() => notif.remove(), 2500);
}

// --- Wire up demo buttons ---
const btnToggle = document.getElementById('btn-toggle') as HTMLButtonElement;
const btnSimulate = document.getElementById('btn-simulate') as HTMLButtonElement;
const btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement;
const testInput = document.getElementById('test-transcript') as HTMLInputElement;
const selPolicy = document.getElementById('sel-policy') as HTMLSelectElement;

// Mode badge
const modeBadge = document.getElementById('mode-badge')!;
if (isRealMode) {
  modeBadge.textContent = 'Real Audio';
  modeBadge.style.background = '#4ecca3';
  modeBadge.style.color = '#000';
} else {
  modeBadge.textContent = 'Stub Mode';
  modeBadge.style.background = 'rgba(255,255,255,0.12)';
  modeBadge.style.color = '#888';
}

// Initialize engine
engine.init().then(() => {
  addLogEntry({
    type: 'EngineError',
    ts: Date.now(),
    code: 'KWS_INIT_FAILED', // Using as a generic log type
    message: `Engine initialized (${isRealMode ? 'real audio' : 'stub'} mode)`,
  });
}).catch((err) => {
  addLogEntry({
    type: 'EngineError',
    ts: Date.now(),
    code: 'KWS_INIT_FAILED',
    message: `Init failed: ${err instanceof Error ? err.message : String(err)}`,
  });
});

btnToggle.addEventListener('click', () => {
  if (engine.getState() === 'LISTENING_OFF') {
    engine.startListening();
    btnToggle.textContent = 'Stop Listening';
  } else {
    engine.stopListening();
    btnToggle.textContent = 'Start Listening';
  }
});

// Also sync when the overlay indicator is toggled
document.addEventListener('vp-toggle-listening', () => {
  // The overlay handles the engine toggle; we just sync our button text
  setTimeout(() => {
    btnToggle.textContent =
      engine.getState() === 'LISTENING_OFF' ? 'Start Listening' : 'Stop Listening';
  }, 50);
});

btnSimulate.addEventListener('click', () => {
  const transcript = testInput.value.trim();
  if (!transcript) {
    showNotification('Enter a label to simulate');
    return;
  }
  if (engine.getState() === 'LISTENING_OFF') {
    showNotification('Start listening first');
    return;
  }
  engine.simulateTranscript(transcript);
});

testInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnSimulate.click();
  }
});

btnCancel.addEventListener('click', () => {
  engine.cancel();
});

selPolicy.addEventListener('change', () => {
  const policy = selPolicy.value as CollisionPolicy;
  // Recreate engine with new config — for simplicity, just update the config
  (engine as any).config.collisionPolicy = policy;
  showNotification(`Collision policy: ${policy}`);
});

// --- Wire up demo page buttons to show action feedback ---
document.querySelectorAll('.demo-btn, .demo-nav a, .tab-btn').forEach((el) => {
  el.addEventListener('click', (e) => {
    // Prevent navigation for demo links
    if (el.tagName === 'A') e.preventDefault();
    const label =
      el.getAttribute('data-voice-label') ||
      (el as HTMLElement).innerText?.trim() ||
      'unknown';
    showNotification(`Clicked: "${label}"`);
  });
});

// --- Interactive Tutorial ---
function resetAppState(): void {
  // Stop listening if active
  if (engine.getState() !== 'LISTENING_OFF') {
    engine.stopListening();
    btnToggle.textContent = 'Start Listening';
  }
  // Clear test input
  testInput.value = '';
  // Reset policy
  selPolicy.value = 'disambiguate';
  (engine as any).config.collisionPolicy = 'disambiguate';
  // Clear event log
  eventLog.innerHTML = '<div class="event-entry"><span class="event-detail">Waiting for events…</span></div>';
  logInitialized = false;
}

const tutorial = new Tutorial([
  {
    target: null,
    title: 'Welcome to VoicePage',
    body: `
      VoicePage lets you navigate and control a web page using your voice.<br><br>
      The core idea is <strong>"say what you see"</strong> — you speak the label of a visible element, and VoicePage finds it and clicks it for you.<br><br>
      This tutorial will walk you through every feature. Let's go!
    `,
  },
  {
    target: '#mode-badge',
    title: 'Mode: Stub vs Real Audio',
    body: `
      VoicePage runs in two modes:<br>
      <strong>Stub mode</strong> (default) — no microphone needed. You type labels to simulate voice input.<br>
      <strong>Real Audio</strong> — uses your mic with trained ML models for keyword detection, speech recognition, and voice activity detection.<br><br>
      You're currently in <strong>${isRealMode ? 'Real Audio' : 'Stub'}</strong> mode.
      ${!isRealMode ? ' Add <code>?mode=real</code> to the URL to switch.' : ''}
    `,
    position: 'bottom',
  },
  {
    target: '.demo-card .btn-row',
    title: 'Voice-Addressable Elements',
    body: `
      These buttons are <strong>voice targets</strong>. Each one has a label that VoicePage can recognize.<br><br>
      Labels come from the button text (<code>Submit</code>, <code>Save Draft</code>), from <code>data-voice-label</code> attributes, or from accessible names like <code>&lt;label&gt;</code> tags.
    `,
    position: 'bottom',
  },
  {
    target: '.tab-bar',
    title: 'Tabs Are Targets Too',
    body: `
      Elements with <code>role="tab"</code> are automatically voice-addressable.<br><br>
      Try saying (or typing) <code>analytics</code> or <code>reports</code> later — VoicePage will activate the matching tab.
    `,
    position: 'bottom',
  },
  {
    target: '[data-voice-label="Billing"]',
    title: 'Custom Labels & Synonyms',
    body: `
      Developers can set <code>data-voice-label</code> for a canonical name and <code>data-voice-synonyms</code> for alternatives.<br><br>
      This link is labeled <strong>"Billing"</strong> but also responds to <strong>"invoices"</strong> and <strong>"payments"</strong>.
    `,
    position: 'top',
  },
  {
    target: '#btn-toggle',
    title: 'Step 1: Start Listening',
    body: `
      Click <strong>"Start Listening"</strong> to enable VoicePage.<br><br>
      In stub mode this just activates the engine. In real audio mode it starts the microphone and keyword detection.
    `,
    position: 'top',
    onEnter: () => {
      // Ensure listening is off so user can click it
      if (engine.getState() !== 'LISTENING_OFF') {
        engine.stopListening();
        btnToggle.textContent = 'Start Listening';
      }
    },
  },
  {
    target: '#test-transcript',
    title: 'Step 2: Type a Target Label',
    body: `
      Type the name of an element you want to interact with.<br><br>
      Try typing <code>submit</code> — this matches the green Submit button above. You can also try <code>billing</code>, <code>analytics</code>, or even a typo like <code>submti</code> (fuzzy matching will catch it).
    `,
    position: 'top',
  },
  {
    target: '#btn-simulate',
    title: 'Step 3: Simulate Voice Input',
    body: `
      Click <strong>"Simulate Open"</strong> (or press Enter) to simulate saying "open" followed by your typed label.<br><br>
      This triggers the full pipeline: keyword detection → speech capture → transcription → target matching → action execution.
    `,
    position: 'top',
  },
  {
    target: '#event-log',
    title: 'Event Log',
    body: `
      Every engine event is logged here in real-time: keyword detections, capture start/end, transcription results, target matches, and action execution.<br><br>
      This is useful for understanding exactly what VoicePage is doing at each step of the pipeline.
    `,
    position: 'top',
  },
  {
    target: '#sel-policy',
    title: 'Collision Policy',
    body: `
      When multiple elements share the same label, VoicePage needs a strategy:<br><br>
      <strong>disambiguate</strong> — shows a selection modal so you can pick the right one.<br>
      <strong>error</strong> — treats duplicate labels as a developer misconfiguration.<br><br>
      Try typing <code>delete</code> with each policy to see the difference (there are two "Delete" buttons on this page).
    `,
    position: 'top',
  },
  {
    target: '#btn-cancel',
    title: 'Cancel',
    body: `
      Click <strong>"Cancel"</strong> at any time to abort the current voice operation and dismiss any modals.<br><br>
      In real audio mode, saying <strong>"cancel"</strong> does the same thing. Saying <strong>"stop"</strong> interrupts the current capture.
    `,
    position: 'top',
  },
  {
    target: '.demo-nav',
    title: 'Navigation Links',
    body: `
      The nav bar links are also voice targets. They use <code>data-voice-label</code> so you can say <code>home</code>, <code>dashboard</code>, <code>settings</code>, or <code>help</code>.<br><br>
      In real audio mode, VoicePage only targets visible, interactive elements in the current scope (e.g. inside a modal if one is open).
    `,
    position: 'bottom',
  },
  {
    target: null,
    title: 'You\'re Ready!',
    body: `
      That's everything you need to know. Here's a quick summary:<br><br>
      <strong>1.</strong> Click "Start Listening"<br>
      <strong>2.</strong> Type a label (e.g. <code>submit</code>)<br>
      <strong>3.</strong> Click "Simulate Open" or press Enter<br>
      <strong>4.</strong> Watch the element get highlighted and clicked<br><br>
      Click the <strong>Tutorial</strong> button in the header anytime to restart this guide.
    `,
  },
], (action) => {
  if (action === 'start') resetAppState();
});

// Tutorial button in header
const btnTutorial = document.getElementById('btn-tutorial')!;
btnTutorial.addEventListener('click', () => {
  resetAppState();
  tutorial.start();
});

// Auto-start tutorial on first visit
const tutorialSeen = localStorage.getItem('vp-tutorial-seen');
if (!tutorialSeen) {
  // Small delay to let the page fully render
  setTimeout(() => tutorial.start(), 500);
  localStorage.setItem('vp-tutorial-seen', '1');
}
