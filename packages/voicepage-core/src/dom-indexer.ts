import { DomTarget, VoicePageConfig } from './types.js';
import { normalizeLabel } from './normalize.js';

let targetIdCounter = 0;

function nextTargetId(): string {
  return `vp-target-${++targetIdCounter}`;
}

// --- Scope root selection ---

function findTopmostModal(): Element | null {
  const selectors = [
    'dialog[open]',
    '[role="dialog"][aria-modal="true"]',
    '[aria-modal="true"]',
    '[data-voice-modal="true"]',
  ];

  const candidates: Element[] = [];
  for (const sel of selectors) {
    candidates.push(...Array.from(document.querySelectorAll(sel)));
  }

  // Filter to visible
  const visible = candidates.filter((el) => {
    const style = getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      el.getClientRects().length > 0
    );
  });

  if (visible.length === 0) return null;
  if (visible.length === 1) return visible[0];

  // Sort by z-index desc, then DOM order (later wins on tie)
  visible.sort((a, b) => {
    const zA = parseInt(getComputedStyle(a).zIndex) || 0;
    const zB = parseInt(getComputedStyle(b).zIndex) || 0;
    if (zA !== zB) return zB - zA;
    // Later in DOM wins — compare positions
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return -1;
    return 0;
  });

  return visible[0];
}

// --- Eligibility ---

const ELIGIBLE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const ELIGIBLE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'option']);

function isEligible(el: Element): boolean {
  if (el.hasAttribute('data-voice-label')) return true;
  if (ELIGIBLE_TAGS.has(el.tagName)) {
    if (el.tagName === 'A' && !el.hasAttribute('href')) return false;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') return false;
    return true;
  }
  const role = el.getAttribute('role');
  if (role && ELIGIBLE_ROLES.has(role)) return true;
  return false;
}

// --- Visibility ---

function isVisible(el: Element): boolean {
  if ((el as HTMLElement).hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el.getClientRects().length === 0) return false;
  return true;
}

// --- Allow / Deny ---

function isAllowed(el: Element, globalDenySelectors: string[]): boolean {
  if (el.getAttribute('data-voice-deny') === 'true') return false;
  if (el.getAttribute('data-voice-allow') === 'true') return true;
  for (const sel of globalDenySelectors) {
    if (el.matches(sel)) return false;
  }
  return true;
}

// --- Label extraction ---

function getVisibleText(el: Element): string {
  const inner = (el as HTMLElement).innerText?.trim();
  if (inner) return inner;
  return el.textContent?.trim() ?? '';
}

function extractRawLabel(el: Element): string {
  // 1. data-voice-label
  const voiceLabel = el.getAttribute('data-voice-label');
  if (voiceLabel?.trim()) return voiceLabel.trim();

  // 2. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();

  // 3. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const texts = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((refEl) => getVisibleText(refEl!));
    const joined = texts.join(' ').trim();
    if (joined) return joined;
  }

  // 4. Associated <label>
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) {
      const t = getVisibleText(label);
      if (t) return t;
    }
  }
  // Ancestor <label>
  const ancestorLabel = el.closest('label');
  if (ancestorLabel) {
    const t = getVisibleText(ancestorLabel);
    if (t) return t;
  }

  // 5. Visible text
  const visText = getVisibleText(el);
  if (visText) return visText;

  // 6. Placeholder
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const ph = (el as HTMLInputElement).placeholder?.trim();
    if (ph) return ph;
  }

  // 7. title
  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  return '';
}

function extractSynonyms(el: Element): string[] {
  const attr = el.getAttribute('data-voice-synonyms');
  if (!attr) return [];
  return attr.split(',').map((s) => normalizeLabel(s)).filter(Boolean);
}

// --- Build index ---

export interface DomIndexResult {
  targets: DomTarget[];
  scope: 'page' | 'modal';
}

export function buildDomIndex(config: VoicePageConfig): DomIndexResult {
  const modalRoot = findTopmostModal();
  const scopeRoot = modalRoot ?? document;
  const scope: 'page' | 'modal' = modalRoot ? 'modal' : 'page';

  const allElements = scopeRoot.querySelectorAll('*');
  const targets: DomTarget[] = [];

  for (const el of allElements) {
    if (!isEligible(el)) continue;
    if (!isVisible(el)) continue;
    if (!isAllowed(el, config.globalDenySelectors)) continue;

    const rawLabel = extractRawLabel(el);
    if (!rawLabel) continue;

    const normalized = normalizeLabel(rawLabel);
    if (!normalized) continue;

    // Assign a stable ID if not present
    let id = el.getAttribute('data-voice-id');
    if (!id) {
      id = nextTargetId();
      el.setAttribute('data-voice-id', id);
    }

    targets.push({
      id,
      element: el,
      rawLabel,
      normalizedLabel: normalized,
      synonyms: extractSynonyms(el),
      risk: el.getAttribute('data-voice-risk') === 'high' ? 'high' : undefined,
    });
  }

  return { targets, scope };
}
