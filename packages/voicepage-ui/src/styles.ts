export const BASE_STYLES = `
  :host {
    --vp-bg: var(--voicepage-bg, #1a1a2e);
    --vp-bg-secondary: var(--voicepage-bg-secondary, #16213e);
    --vp-text: var(--voicepage-text, #eee);
    --vp-text-muted: var(--voicepage-text-muted, #999);
    --vp-accent: var(--voicepage-accent, #4ecca3);
    --vp-accent-dim: var(--voicepage-accent-dim, #2d8a6e);
    --vp-error: var(--voicepage-error, #e74c3c);
    --vp-warning: var(--voicepage-warning, #f39c12);
    --vp-highlight: var(--voicepage-highlight, rgba(78, 204, 163, 0.35));
    --vp-radius: var(--voicepage-radius, 10px);
    --vp-z: var(--voicepage-z-index, 99999);
    --vp-font: var(--voicepage-font, system-ui, -apple-system, sans-serif);

    font-family: var(--vp-font);
    color: var(--vp-text);
  }
`;

export const MODAL_STYLES = `
  .vp-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: var(--vp-z);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: vp-fade-in 0.15s ease-out;
  }

  .vp-modal {
    background: var(--vp-bg);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: var(--vp-radius);
    padding: 24px;
    max-width: 440px;
    width: 90vw;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    animation: vp-slide-up 0.2s ease-out;
  }

  .vp-modal h2 {
    margin: 0 0 12px;
    font-size: 18px;
    font-weight: 600;
  }

  .vp-modal p {
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--vp-text-muted);
    line-height: 1.5;
  }

  .vp-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .vp-btn {
    padding: 8px 18px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    font-family: var(--vp-font);
    transition: background 0.15s;
  }

  .vp-btn-primary {
    background: var(--vp-accent);
    color: #000;
  }
  .vp-btn-primary:hover {
    background: var(--vp-accent-dim);
    color: #fff;
  }

  .vp-btn-secondary {
    background: rgba(255,255,255,0.1);
    color: var(--vp-text);
  }
  .vp-btn-secondary:hover {
    background: rgba(255,255,255,0.2);
  }

  .vp-btn-danger {
    background: var(--vp-error);
    color: #fff;
  }
  .vp-btn-danger:hover {
    background: #c0392b;
  }

  .vp-candidate-list {
    list-style: none;
    padding: 0;
    margin: 8px 0;
  }

  .vp-candidate-item {
    padding: 10px 14px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,0.08);
    margin-bottom: 6px;
    transition: background 0.1s;
    font-size: 14px;
  }

  .vp-candidate-item:hover {
    background: rgba(78, 204, 163, 0.15);
    border-color: var(--vp-accent-dim);
  }

  .vp-transcript {
    display: inline-block;
    background: rgba(255,255,255,0.08);
    padding: 4px 10px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 13px;
  }

  .vp-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .vp-tag-error { background: var(--vp-error); color: #fff; }
  .vp-tag-warn { background: var(--vp-warning); color: #000; }

  @keyframes vp-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes vp-slide-up {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
