import { ActionType, DomTarget } from './types.js';

/**
 * Determine the default action for a target element.
 */
export function determineAction(target: DomTarget): ActionType {
  const el = target.element;
  const tag = el.tagName;
  const role = el.getAttribute('role');

  // Button or link: click
  if (tag === 'BUTTON' || tag === 'A' || role === 'button' || role === 'link') {
    return 'click';
  }

  // Tab or menuitem: activate (click)
  if (role === 'tab' || role === 'menuitem' || role === 'option' || tag === 'SUMMARY') {
    return 'activate';
  }

  // Input/select/textarea: focus
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    return 'focus';
  }

  // Fallback: scroll into view + focus
  return 'scroll_focus';
}

/**
 * Execute the determined action on the target element.
 */
export function executeAction(target: DomTarget, action: ActionType): { ok: boolean; error?: string } {
  try {
    const el = target.element as HTMLElement;

    switch (action) {
      case 'click':
      case 'activate':
        el.click();
        break;
      case 'focus':
        el.focus();
        break;
      case 'scroll_focus':
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus?.();
        break;
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
