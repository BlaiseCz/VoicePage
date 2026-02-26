import {
  VoicePageEngine,
  StubKwsEngine,
  StubVadEngine,
  StubAsrEngine,
  VoicePageEvent,
  CollisionPolicy,
} from 'voicepage-core';
import { VoicepageOverlay } from 'voicepage-ui';

// --- Initialize stub engines ---
const kwsEngine = new StubKwsEngine();
const vadEngine = new StubVadEngine(500); // Short delay for demo
const asrEngine = new StubAsrEngine();

const engine = new VoicePageEngine(kwsEngine, vadEngine, asrEngine, {
  collisionPolicy: 'disambiguate',
  highlightMs: 400,
});

// --- Connect UI overlay ---
const overlay = document.getElementById('vp-overlay') as VoicepageOverlay;
overlay.connectEngine(engine);

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

// Initialize engine
engine.init().then(() => {
  addLogEntry({
    type: 'EngineError',
    ts: Date.now(),
    code: 'KWS_INIT_FAILED', // Using as a generic log type
    message: 'Engine initialized (stub mode)',
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
