// --- Interactive Tutorial System ---

interface TutorialStep {
  /** CSS selector for the element to highlight (null = centered, no highlight) */
  target: string | null;
  /** Title shown in the popup */
  title: string;
  /** Body text (supports HTML) */
  body: string;
  /** Optional: action to run when this step becomes active */
  onEnter?: () => void;
  /** Optional: action to run when leaving this step */
  onLeave?: () => void;
  /** Position of popup relative to target */
  position?: 'top' | 'bottom' | 'left' | 'right';
}

type TutorialCallback = (action: 'start' | 'end') => void;

export class Tutorial {
  private steps: TutorialStep[] = [];
  private currentStep = -1;
  private backdropEl!: HTMLDivElement;
  private popupEl!: HTMLDivElement;
  private spotlightEl!: HTMLDivElement;
  private callback: TutorialCallback | null = null;
  private repositionHandler = () => this.positionPopup();

  constructor(steps: TutorialStep[], callback?: TutorialCallback) {
    this.steps = steps;
    this.callback = callback ?? null;
    this.createDOM();
  }

  private createDOM(): void {
    // Backdrop with hole for spotlight
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'tutorial-backdrop';
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) {
        // Click on backdrop does nothing — user must use buttons
      }
    });

    // Spotlight ring around target element
    this.spotlightEl = document.createElement('div');
    this.spotlightEl.className = 'tutorial-spotlight';

    // Popup card
    this.popupEl = document.createElement('div');
    this.popupEl.className = 'tutorial-popup';

    this.backdropEl.appendChild(this.spotlightEl);
    this.backdropEl.appendChild(this.popupEl);
  }

  start(): void {
    this.callback?.('start');
    document.body.appendChild(this.backdropEl);
    window.addEventListener('resize', this.repositionHandler);
    window.addEventListener('scroll', this.repositionHandler, true);
    this.currentStep = -1;
    this.next();
  }

  stop(): void {
    if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
      this.steps[this.currentStep].onLeave?.();
    }
    this.currentStep = -1;
    this.backdropEl.remove();
    window.removeEventListener('resize', this.repositionHandler);
    window.removeEventListener('scroll', this.repositionHandler, true);
    this.callback?.('end');
  }

  next(): void {
    if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
      this.steps[this.currentStep].onLeave?.();
    }
    this.currentStep++;
    if (this.currentStep >= this.steps.length) {
      this.stop();
      return;
    }
    this.renderStep();
  }

  back(): void {
    if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
      this.steps[this.currentStep].onLeave?.();
    }
    this.currentStep = Math.max(0, this.currentStep - 1);
    this.renderStep();
  }

  goTo(stepIndex: number): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;
    if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
      this.steps[this.currentStep].onLeave?.();
    }
    this.currentStep = stepIndex;
    this.renderStep();
  }

  private renderStep(): void {
    const step = this.steps[this.currentStep];
    const stepNum = this.currentStep + 1;
    const total = this.steps.length;

    step.onEnter?.();

    // Progress dots
    const dots = this.steps.map((_, i) =>
      `<span class="tutorial-dot ${i === this.currentStep ? 'active' : i < this.currentStep ? 'done' : ''}" data-step="${i}" title="Step ${i + 1}"></span>`
    ).join('');

    // Buttons
    const isFirst = this.currentStep === 0;
    const isLast = this.currentStep === this.steps.length - 1;

    this.popupEl.innerHTML = `
      <div class="tutorial-popup-header">
        <span class="tutorial-step-label">Step ${stepNum} of ${total}</span>
        <button class="tutorial-close-btn" title="Close tutorial">&times;</button>
      </div>
      <h3 class="tutorial-title">${step.title}</h3>
      <div class="tutorial-body">${step.body}</div>
      <div class="tutorial-footer">
        <div class="tutorial-dots">${dots}</div>
        <div class="tutorial-btns">
          ${!isFirst ? '<button class="tutorial-btn tutorial-btn-back">Back</button>' : ''}
          <button class="tutorial-btn tutorial-btn-next">${isLast ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    `;

    // Wire buttons
    this.popupEl.querySelector('.tutorial-close-btn')!.addEventListener('click', () => this.stop());
    this.popupEl.querySelector('.tutorial-btn-next')!.addEventListener('click', () => this.next());
    const backBtn = this.popupEl.querySelector('.tutorial-btn-back');
    if (backBtn) backBtn.addEventListener('click', () => this.back());

    // Wire clickable dots
    this.popupEl.querySelectorAll('.tutorial-dot[data-step]').forEach((dot) => {
      dot.addEventListener('click', () => {
        const idx = parseInt((dot as HTMLElement).dataset.step!, 10);
        this.goTo(idx);
      });
    });

    this.positionPopup();
  }

  private positionPopup(): void {
    const step = this.steps[this.currentStep];
    if (!step) return;

    const target = step.target ? document.querySelector(step.target) as HTMLElement : null;

    if (target) {
      const rect = target.getBoundingClientRect();
      const pad = 6;

      // Position spotlight — spotlight box-shadow creates the dimming
      this.backdropEl.classList.remove('no-spotlight');
      this.spotlightEl.style.display = 'block';
      this.spotlightEl.style.position = 'fixed';
      this.spotlightEl.style.top = `${rect.top - pad}px`;
      this.spotlightEl.style.left = `${rect.left - pad}px`;
      this.spotlightEl.style.width = `${rect.width + pad * 2}px`;
      this.spotlightEl.style.height = `${rect.height + pad * 2}px`;

      // Scroll target into view if needed
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Position popup relative to target
      const pos = step.position ?? this.autoPosition(rect);
      this.popupEl.classList.remove('pos-top', 'pos-bottom', 'pos-left', 'pos-right', 'pos-center');
      this.popupEl.classList.add(`pos-${pos}`);

      // Calculate popup position
      const popupW = 360;
      const gap = 16;
      let top: number, left: number;

      switch (pos) {
        case 'bottom':
          top = rect.bottom + gap;
          left = rect.left + rect.width / 2 - popupW / 2;
          break;
        case 'top':
          top = rect.top - gap;
          left = rect.left + rect.width / 2 - popupW / 2;
          this.popupEl.style.transform = 'translateY(-100%)';
          break;
        case 'right':
          top = rect.top + rect.height / 2;
          left = rect.right + gap;
          this.popupEl.style.transform = 'translateY(-50%)';
          break;
        case 'left':
          top = rect.top + rect.height / 2;
          left = rect.left - gap - popupW;
          this.popupEl.style.transform = 'translateY(-50%)';
          break;
        default:
          top = rect.bottom + gap;
          left = rect.left + rect.width / 2 - popupW / 2;
      }

      // Clamp to viewport
      left = Math.max(16, Math.min(left, window.innerWidth - popupW - 16));

      if (pos !== 'top') {
        this.popupEl.style.transform = '';
      }

      this.popupEl.style.position = 'fixed';
      this.popupEl.style.top = `${top}px`;
      this.popupEl.style.left = `${left}px`;
      this.popupEl.style.width = `${popupW}px`;
    } else {
      // No target — center the popup, use backdrop background for dimming
      this.backdropEl.classList.add('no-spotlight');
      this.spotlightEl.style.display = 'none';
      this.popupEl.classList.remove('pos-top', 'pos-bottom', 'pos-left', 'pos-right');
      this.popupEl.classList.add('pos-center');
      this.popupEl.style.position = 'fixed';
      this.popupEl.style.top = '50%';
      this.popupEl.style.left = '50%';
      this.popupEl.style.transform = 'translate(-50%, -50%)';
      this.popupEl.style.width = '420px';
    }
  }

  private autoPosition(rect: DOMRect): 'top' | 'bottom' | 'left' | 'right' {
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow > 200) return 'bottom';
    if (spaceAbove > 200) return 'top';
    return 'bottom';
  }
}

// --- Inject tutorial CSS into <head> ---
const tutorialStyles = document.createElement('style');
tutorialStyles.textContent = `
  .tutorial-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100000;
    pointer-events: auto;
  }

  /* Dim layer — only shown when no spotlight is active (centered popups) */
  .tutorial-backdrop.no-spotlight {
    background: rgba(0, 0, 0, 0.65);
  }
  .tutorial-backdrop:not(.no-spotlight) {
    background: transparent;
    pointer-events: none;
  }

  .tutorial-spotlight {
    position: absolute;
    border-radius: 8px;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.65);
    background: transparent;
    border: 2px solid #4ecca3;
    pointer-events: none;
    transition: all 0.3s ease;
    z-index: 100001;
  }

  .tutorial-popup {
    z-index: 100002;
    background: #1a1a2e;
    border: 1px solid rgba(78, 204, 163, 0.4);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    animation: tutorial-fade-in 0.25s ease-out;
    max-width: calc(100vw - 32px);
    pointer-events: auto;
  }

  @keyframes tutorial-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; }
  }

  .tutorial-popup.pos-center {
    animation: tutorial-scale-in 0.3s ease-out;
  }
  @keyframes tutorial-scale-in {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .tutorial-popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .tutorial-step-label {
    font-size: 11px;
    color: #4ecca3;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tutorial-close-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    transition: color 0.15s;
  }
  .tutorial-close-btn:hover { color: #e74c3c; }

  .tutorial-title {
    font-size: 16px;
    font-weight: 700;
    color: #e0e0e0;
    margin-bottom: 8px;
  }

  .tutorial-body {
    font-size: 14px;
    color: #999;
    line-height: 1.6;
    margin-bottom: 16px;
  }
  .tutorial-body code {
    background: rgba(78, 204, 163, 0.15);
    color: #4ecca3;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
  }
  .tutorial-body strong {
    color: #ccc;
  }

  .tutorial-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tutorial-dots {
    display: flex;
    gap: 6px;
  }

  .tutorial-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    transition: all 0.2s;
    cursor: pointer;
  }
  .tutorial-dot:hover {
    background: rgba(78, 204, 163, 0.6);
    transform: scale(1.3);
  }
  .tutorial-dot.active {
    background: #4ecca3;
    transform: scale(1.2);
  }
  .tutorial-dot.done {
    background: rgba(78, 204, 163, 0.4);
  }

  .tutorial-btns {
    display: flex;
    gap: 8px;
  }

  .tutorial-btn {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s;
    font-family: inherit;
  }

  .tutorial-btn-back {
    background: rgba(255, 255, 255, 0.06);
    color: #999;
    border-color: rgba(255, 255, 255, 0.1);
  }
  .tutorial-btn-back:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ccc;
  }

  .tutorial-btn-next {
    background: #4ecca3;
    color: #000;
  }
  .tutorial-btn-next:hover {
    background: #3dbb92;
  }
`;
document.head.appendChild(tutorialStyles);
