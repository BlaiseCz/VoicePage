import { BASE_STYLES } from './styles.js';

const template = document.createElement('template');
template.innerHTML = `
<style>
  ${BASE_STYLES}

  .vp-indicator {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: var(--vp-z);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    border-radius: 50px;
    background: var(--vp-bg);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    cursor: pointer;
    user-select: none;
    transition: all 0.2s;
  }

  .vp-indicator:hover {
    border-color: var(--vp-accent-dim);
    box-shadow: 0 4px 24px rgba(78, 204, 163, 0.15);
  }

  .vp-mic-icon {
    width: 20px;
    height: 20px;
    fill: var(--vp-text-muted);
    transition: fill 0.2s;
  }

  :host([listening]) .vp-mic-icon {
    fill: var(--vp-accent);
  }

  .vp-status-text {
    font-size: 13px;
    font-weight: 500;
    color: var(--vp-text-muted);
    transition: color 0.2s;
  }

  :host([listening]) .vp-status-text {
    color: var(--vp-accent);
  }

  .vp-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vp-text-muted);
    transition: background 0.2s;
  }

  :host([listening]) .vp-pulse {
    background: var(--vp-accent);
    animation: vp-pulse-anim 1.5s ease-in-out infinite;
  }

  .vp-keyword-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--vp-accent);
    color: #000;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .vp-keyword-badge.visible {
    opacity: 1;
  }

  @keyframes vp-pulse-anim {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.3); }
  }
</style>

<div class="vp-indicator" part="indicator" role="button" tabindex="0" aria-label="Toggle voice listening">
  <div class="vp-pulse"></div>
  <svg class="vp-mic-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
  <span class="vp-status-text">Mic Off</span>
  <span class="vp-keyword-badge"></span>
</div>
`;

export class VoicepageListeningIndicator extends HTMLElement {
  private statusText!: HTMLSpanElement;
  private keywordBadge!: HTMLSpanElement;
  private badgeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
  }

  connectedCallback(): void {
    this.statusText = this.shadowRoot!.querySelector('.vp-status-text')!;
    this.keywordBadge = this.shadowRoot!.querySelector('.vp-keyword-badge')!;

    const indicator = this.shadowRoot!.querySelector('.vp-indicator')!;
    indicator.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('vp-toggle-listening', { bubbles: true, composed: true }));
    });
    indicator.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('vp-toggle-listening', { bubbles: true, composed: true }));
      }
    });
  }

  setListening(enabled: boolean): void {
    if (enabled) {
      this.setAttribute('listening', '');
      this.statusText.textContent = 'Listening';
    } else {
      this.removeAttribute('listening');
      this.statusText.textContent = 'Mic Off';
    }
  }

  showKeyword(keyword: string): void {
    this.keywordBadge.textContent = keyword;
    this.keywordBadge.classList.add('visible');
    if (this.badgeTimer) clearTimeout(this.badgeTimer);
    this.badgeTimer = setTimeout(() => {
      this.keywordBadge.classList.remove('visible');
    }, 1500);
  }

  setStatus(text: string): void {
    this.statusText.textContent = text;
  }
}

customElements.define('voicepage-listening-indicator', VoicepageListeningIndicator);
