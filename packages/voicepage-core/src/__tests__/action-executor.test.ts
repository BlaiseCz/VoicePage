/// <reference types="vitest/globals" />

import { describe, it, expect, vi } from 'vitest';
import { determineAction, executeAction } from '../action-executor.js';
import type { DomTarget } from '../types.js';

// --- Helpers ---

function makeElement(overrides: {
  tagName: string;
  role?: string | null;
}): Element {
  const el = {
    tagName: overrides.tagName,
    getAttribute: vi.fn((attr: string) => {
      if (attr === 'role') return overrides.role ?? null;
      return null;
    }),
    click: vi.fn(),
    focus: vi.fn(),
    scrollIntoView: vi.fn(),
  };
  return el as unknown as Element;
}

function makeTarget(el: Element): DomTarget {
  return {
    id: 'vp-test',
    element: el,
    rawLabel: 'Test',
    normalizedLabel: 'test',
    synonyms: [],
  };
}

// --- Tests ---

describe('determineAction', () => {
  it('should return "click" for BUTTON', () => {
    const el = makeElement({ tagName: 'BUTTON' });
    expect(determineAction(makeTarget(el))).toBe('click');
  });

  it('should return "click" for A', () => {
    const el = makeElement({ tagName: 'A' });
    expect(determineAction(makeTarget(el))).toBe('click');
  });

  it('should return "click" for role=button', () => {
    const el = makeElement({ tagName: 'DIV', role: 'button' });
    expect(determineAction(makeTarget(el))).toBe('click');
  });

  it('should return "click" for role=link', () => {
    const el = makeElement({ tagName: 'SPAN', role: 'link' });
    expect(determineAction(makeTarget(el))).toBe('click');
  });

  it('should return "activate" for role=tab', () => {
    const el = makeElement({ tagName: 'DIV', role: 'tab' });
    expect(determineAction(makeTarget(el))).toBe('activate');
  });

  it('should return "activate" for role=menuitem', () => {
    const el = makeElement({ tagName: 'LI', role: 'menuitem' });
    expect(determineAction(makeTarget(el))).toBe('activate');
  });

  it('should return "activate" for role=option', () => {
    const el = makeElement({ tagName: 'DIV', role: 'option' });
    expect(determineAction(makeTarget(el))).toBe('activate');
  });

  it('should return "activate" for SUMMARY', () => {
    const el = makeElement({ tagName: 'SUMMARY' });
    expect(determineAction(makeTarget(el))).toBe('activate');
  });

  it('should return "focus" for INPUT', () => {
    const el = makeElement({ tagName: 'INPUT' });
    expect(determineAction(makeTarget(el))).toBe('focus');
  });

  it('should return "focus" for SELECT', () => {
    const el = makeElement({ tagName: 'SELECT' });
    expect(determineAction(makeTarget(el))).toBe('focus');
  });

  it('should return "focus" for TEXTAREA', () => {
    const el = makeElement({ tagName: 'TEXTAREA' });
    expect(determineAction(makeTarget(el))).toBe('focus');
  });

  it('should return "scroll_focus" for unknown elements', () => {
    const el = makeElement({ tagName: 'DIV' });
    expect(determineAction(makeTarget(el))).toBe('scroll_focus');
  });
});

describe('executeAction', () => {
  it('should click for "click" action', () => {
    const el = makeElement({ tagName: 'BUTTON' });
    const target = makeTarget(el);
    const result = executeAction(target, 'click');

    expect(result.ok).toBe(true);
    expect((el as any).click).toHaveBeenCalledTimes(1);
  });

  it('should click for "activate" action', () => {
    const el = makeElement({ tagName: 'DIV', role: 'tab' });
    const target = makeTarget(el);
    const result = executeAction(target, 'activate');

    expect(result.ok).toBe(true);
    expect((el as any).click).toHaveBeenCalledTimes(1);
  });

  it('should focus for "focus" action', () => {
    const el = makeElement({ tagName: 'INPUT' });
    const target = makeTarget(el);
    const result = executeAction(target, 'focus');

    expect(result.ok).toBe(true);
    expect((el as any).focus).toHaveBeenCalledTimes(1);
  });

  it('should scrollIntoView + focus for "scroll_focus" action', () => {
    const el = makeElement({ tagName: 'DIV' });
    const target = makeTarget(el);
    const result = executeAction(target, 'scroll_focus');

    expect(result.ok).toBe(true);
    expect((el as any).scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    expect((el as any).focus).toHaveBeenCalled();
  });

  it('should return ok=false and error message when action throws', () => {
    const el = makeElement({ tagName: 'BUTTON' });
    (el as any).click = vi.fn(() => {
      throw new Error('click failed');
    });
    const target = makeTarget(el);
    const result = executeAction(target, 'click');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('click failed');
  });
});
