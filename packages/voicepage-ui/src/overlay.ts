import type { VoicePageEngine, VoicePageEvent } from 'voicepage-core';
import { VoicepageListeningIndicator } from './listening-indicator.js';
import { VoicepageHighlightLayer } from './highlight-layer.js';
import { VoicepageModal } from './modal.js';
import { BASE_STYLES } from './styles.js';

export class VoicepageOverlay extends HTMLElement {
  private engine: VoicePageEngine | null = null;
  private unsubscribe: (() => void) | null = null;

  private indicator!: VoicepageListeningIndicator;
  private highlightLayer!: VoicepageHighlightLayer;
  private modal!: VoicepageModal;
  private lastTranscript: string = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `
      <style>
        ${BASE_STYLES}
        :host { display: contents; }
      </style>
      <voicepage-listening-indicator></voicepage-listening-indicator>
      <voicepage-highlight-layer></voicepage-highlight-layer>
      <voicepage-modal></voicepage-modal>
    `;
  }

  connectedCallback(): void {
    this.indicator = this.shadowRoot!.querySelector('voicepage-listening-indicator')!;
    this.highlightLayer = this.shadowRoot!.querySelector('voicepage-highlight-layer')!;
    this.modal = this.shadowRoot!.querySelector('voicepage-modal')!;

    // Listen for UI events
    this.addEventListener('vp-toggle-listening', () => {
      if (!this.engine) return;
      if (this.engine.getState() === 'LISTENING_OFF') {
        this.engine.startListening();
      } else {
        this.engine.stopListening();
      }
    });

    this.addEventListener('vp-modal-cancel', () => {
      this.engine?.cancel();
    });

    this.addEventListener('vp-select-target', ((e: CustomEvent) => {
      const targetId = e.detail?.targetId;
      if (targetId && this.engine) {
        this.engine.selectDisambiguationTarget(targetId);
      }
    }) as EventListener);

    this.addEventListener('vp-confirm-action', (() => {
      this.engine?.confirmAction();
    }) as EventListener);
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
  }

  /**
   * Connect this overlay to a VoicePageEngine instance.
   */
  connectEngine(engine: VoicePageEngine): void {
    this.unsubscribe?.();
    this.engine = engine;
    this.unsubscribe = engine.on(this.handleEvent.bind(this));
  }

  private handleEvent(event: VoicePageEvent): void {
    switch (event.type) {
      case 'ListeningChanged':
        this.indicator.setListening(event.enabled);
        if (!event.enabled) {
          this.modal.close();
          this.highlightLayer.clear();
        }
        break;

      case 'KeywordDetected':
        this.indicator.showKeyword(event.keyword);
        break;

      case 'CaptureStarted':
        this.indicator.setStatus('Say target…');
        this.modal.showPrompt('Say the name of the element you want to interact with.');
        break;

      case 'CaptureEnded':
        if (event.reason === 'cancel' || event.reason === 'stop') {
          this.modal.close();
          this.indicator.setStatus('Listening');
        }
        break;

      case 'TranscriptionStarted':
        this.indicator.setStatus('Transcribing…');
        break;

      case 'TranscriptReady':
        this.lastTranscript = event.transcript;
        this.modal.close();
        break;

      case 'TargetResolved': {
        // Highlight the resolved target
        const index = this.engine?.getCurrentIndex();
        if (index) {
          const target = index.targets.find((t) => t.id === event.targetId);
          if (target) {
            this.highlightLayer.highlightElement(
              target.element,
              this.engine?.getConfig().highlightMs ?? 300,
            );
          }
        }
        break;
      }

      case 'TargetResolutionFailed':
        switch (event.reason) {
          case 'no_match':
            this.modal.showNoMatch(this.lastTranscript);
            break;
          case 'ambiguous': {
            const details = event.details as {
              candidates?: Array<{ targetId: string; label: string; score: number }>;
            };
            this.modal.showAmbiguous(
              this.lastTranscript,
              details?.candidates ?? [],
            );
            break;
          }
          case 'misconfiguration': {
            const miscDetails = event.details as {
              duplicateLabels?: Record<string, string[]>;
            };
            const firstLabel = miscDetails?.duplicateLabels
              ? Object.keys(miscDetails.duplicateLabels)[0]
              : undefined;
            const elements = firstLabel
              ? miscDetails?.duplicateLabels?.[firstLabel]
              : undefined;
            this.modal.showMisconfiguration({
              label: firstLabel,
              elements,
            });
            break;
          }
        }
        break;

      case 'ConfirmationRequired':
        this.modal.showConfirmation(event.action, event.label, event.targetId);
        break;

      case 'ActionExecuted':
        this.highlightLayer.clear();
        if (event.ok) {
          this.indicator.setStatus('Listening');
        } else {
          this.indicator.setStatus('Error');
          setTimeout(() => {
            if (this.engine?.getState() !== 'LISTENING_OFF') {
              this.indicator.setStatus('Listening');
            }
          }, 2000);
        }
        break;

      case 'EngineError':
        this.indicator.setStatus('Error');
        setTimeout(() => {
          if (this.engine?.getState() !== 'LISTENING_OFF') {
            this.indicator.setStatus('Listening');
          }
        }, 2000);
        break;
    }
  }
}

customElements.define('voicepage-overlay', VoicepageOverlay);
