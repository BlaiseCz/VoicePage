import { BASE_STYLES, MODAL_STYLES } from './styles.js';

export type ModalType = 'prompt' | 'no_match' | 'ambiguous' | 'misconfiguration' | 'confirm';

export interface ModalCandidate {
  targetId: string;
  label: string;
  score?: number;
}

export class VoicepageModal extends HTMLElement {
  private backdrop: HTMLDivElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `
      <style>
        ${BASE_STYLES}
        ${MODAL_STYLES}
      </style>
      <div id="modal-root"></div>
    `;
  }

  connectedCallback(): void {
    document.addEventListener('keydown', this.handleEscape);
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.handleEscape);
  }

  private handleEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.backdrop) {
      this.close();
      this.dispatchEvent(new CustomEvent('vp-modal-cancel', { bubbles: true, composed: true }));
    }
  };

  showPrompt(message: string): void {
    this.renderModal(`
      <h2>🎤 Listening…</h2>
      <p>${this.esc(message)}</p>
      <div class="vp-modal-actions">
        <button class="vp-btn vp-btn-secondary" data-action="cancel">Cancel</button>
      </div>
    `);
  }

  showNoMatch(transcript: string): void {
    this.renderModal(`
      <h2><span class="vp-tag vp-tag-warn">No Match</span></h2>
      <p>Heard: <span class="vp-transcript">${this.esc(transcript)}</span></p>
      <p>Say the words you see on the page.</p>
      <div class="vp-modal-actions">
        <button class="vp-btn vp-btn-primary" data-action="close">Close</button>
      </div>
    `);
  }

  showAmbiguous(transcript: string, candidates: ModalCandidate[]): void {
    const items = candidates
      .map(
        (c) =>
          `<li class="vp-candidate-item" data-target-id="${this.esc(c.targetId)}">
            <strong>${this.esc(c.label)}</strong>
            ${c.score != null ? `<span style="float:right;color:var(--vp-text-muted);font-size:12px">${(c.score * 100).toFixed(0)}%</span>` : ''}
          </li>`,
      )
      .join('');

    this.renderModal(`
      <h2>Multiple matches</h2>
      <p>Heard: <span class="vp-transcript">${this.esc(transcript)}</span></p>
      <p>Select the correct target:</p>
      <ul class="vp-candidate-list">${items}</ul>
      <div class="vp-modal-actions">
        <button class="vp-btn vp-btn-secondary" data-action="cancel">Cancel</button>
      </div>
    `);

    // Attach candidate click handlers
    const listItems = this.shadowRoot!.querySelectorAll('.vp-candidate-item');
    for (const item of listItems) {
      item.addEventListener('click', () => {
        const targetId = (item as HTMLElement).dataset.targetId;
        if (targetId) {
          this.close();
          this.dispatchEvent(
            new CustomEvent('vp-select-target', {
              bubbles: true,
              composed: true,
              detail: { targetId },
            }),
          );
        }
      });
    }
  }

  showMisconfiguration(details: { label?: string; elements?: string[] }): void {
    const elList = (details.elements ?? [])
      .map((e) => `<li style="font-family:monospace;font-size:12px;margin:4px 0">${this.esc(e)}</li>`)
      .join('');

    this.renderModal(`
      <h2><span class="vp-tag vp-tag-error">Misconfiguration</span></h2>
      ${details.label ? `<p>Duplicate label: <span class="vp-transcript">${this.esc(details.label)}</span></p>` : ''}
      ${elList ? `<p>Conflicting elements:</p><ul style="list-style:none;padding:0">${elList}</ul>` : ''}
      <p style="font-size:13px;color:var(--vp-text-muted)">
        Fix: add unique <code>data-voice-label</code> attributes, or mark one as <code>data-voice-deny="true"</code>.
      </p>
      <div class="vp-modal-actions">
        <button class="vp-btn vp-btn-primary" data-action="close">Close</button>
      </div>
    `);
  }

  close(): void {
    const root = this.shadowRoot!.getElementById('modal-root')!;
    root.innerHTML = '';
    this.backdrop = null;
  }

  isOpen(): boolean {
    return this.backdrop !== null;
  }

  private renderModal(content: string): void {
    const root = this.shadowRoot!.getElementById('modal-root')!;
    root.innerHTML = `
      <div class="vp-modal-backdrop">
        <div class="vp-modal" role="dialog" aria-modal="true">
          ${content}
        </div>
      </div>
    `;
    this.backdrop = root.querySelector('.vp-modal-backdrop');

    // Wire up action buttons
    const buttons = root.querySelectorAll('[data-action]');
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        this.close();
        if (action === 'cancel') {
          this.dispatchEvent(new CustomEvent('vp-modal-cancel', { bubbles: true, composed: true }));
        }
      });
    }

    // Focus trap: focus the modal
    const modal = root.querySelector('.vp-modal') as HTMLElement;
    modal?.focus();
  }

  private esc(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

customElements.define('voicepage-modal', VoicepageModal);
