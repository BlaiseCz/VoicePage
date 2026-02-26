import { BASE_STYLES } from './styles.js';

export class VoicepageHighlightLayer extends HTMLElement {
  private overlay: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `
      <style>
        ${BASE_STYLES}

        .vp-highlight-box {
          position: fixed;
          pointer-events: none;
          z-index: var(--vp-z);
          border: 3px solid var(--vp-accent);
          border-radius: 6px;
          background: var(--vp-highlight);
          transition: all 0.15s ease-out;
          box-shadow: 0 0 20px rgba(78, 204, 163, 0.3);
          animation: vp-highlight-pulse 0.6s ease-in-out;
        }

        @keyframes vp-highlight-pulse {
          0% { opacity: 0; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
      </style>
    `;
  }

  highlightElement(element: Element, durationMs: number = 300): void {
    this.clear();

    const rect = element.getBoundingClientRect();
    const pad = 4;

    this.overlay = document.createElement('div');
    this.overlay.className = 'vp-highlight-box';
    this.overlay.style.left = `${rect.left - pad}px`;
    this.overlay.style.top = `${rect.top - pad}px`;
    this.overlay.style.width = `${rect.width + pad * 2}px`;
    this.overlay.style.height = `${rect.height + pad * 2}px`;

    this.shadowRoot!.appendChild(this.overlay);

    this.timer = setTimeout(() => {
      this.clear();
    }, durationMs);
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}

customElements.define('voicepage-highlight-layer', VoicepageHighlightLayer);
