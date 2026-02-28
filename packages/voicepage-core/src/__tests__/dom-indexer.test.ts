/// <reference types="vitest/globals" />
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import { buildDomIndex } from '../dom-indexer.js';
import { DEFAULT_CONFIG } from '../types.js';
import type { VoicePageConfig } from '../types.js';

function makeConfig(overrides?: Partial<VoicePageConfig>): VoicePageConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe('buildDomIndex', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // --- Basic eligibility ---

  describe('eligibility', () => {
    it('should index a <button> with visible text', () => {
      document.body.innerHTML = '<button>Submit</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].normalizedLabel).toBe('submit');
      expect(result.scope).toBe('page');
    });

    it('should index an <a href="..."> link', () => {
      document.body.innerHTML = '<a href="/billing">Billing</a>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].normalizedLabel).toBe('billing');
    });

    it('should skip an <a> without href', () => {
      document.body.innerHTML = '<a>Not a link</a>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(0);
    });

    it('should index elements with eligible roles', () => {
      document.body.innerHTML = '<div role="tab">Analytics</div>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].normalizedLabel).toBe('analytics');
    });

    it('should index elements with data-voice-label', () => {
      document.body.innerHTML = '<div data-voice-label="custom label">Ignored text</div>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].normalizedLabel).toBe('custom label');
    });

    it('should skip hidden inputs', () => {
      document.body.innerHTML = '<input type="hidden" aria-label="secret">';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(0);
    });

    it('should skip non-eligible elements without data-voice-label', () => {
      document.body.innerHTML = '<div>Just a div</div><p>Just a paragraph</p>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(0);
    });
  });

  // --- Label extraction priority ---

  describe('label extraction', () => {
    it('should prefer data-voice-label over aria-label', () => {
      document.body.innerHTML = '<button data-voice-label="Voice Label" aria-label="Aria Label">Text</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets[0].rawLabel).toBe('Voice Label');
    });

    it('should use aria-label when data-voice-label is absent', () => {
      document.body.innerHTML = '<button aria-label="Aria Label">Text</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets[0].rawLabel).toBe('Aria Label');
    });

    it('should extract synonyms from data-voice-synonyms', () => {
      document.body.innerHTML = '<button data-voice-label="Billing" data-voice-synonyms="invoices, payments">Billing</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets[0].synonyms).toEqual(['invoices', 'payments']);
    });

    it('should use placeholder for inputs without other labels', () => {
      document.body.innerHTML = '<input type="text" placeholder="Search...">';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].normalizedLabel).toBe('search...');
    });

    it('should use title attribute as fallback', () => {
      document.body.innerHTML = '<button title="Go Back"></button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].rawLabel).toBe('Go Back');
    });

    it('should skip elements with no extractable label', () => {
      document.body.innerHTML = '<button></button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(0);
    });
  });

  // --- Allow / Deny ---

  describe('allow / deny', () => {
    it('should skip elements with data-voice-deny="true"', () => {
      document.body.innerHTML = '<button data-voice-deny="true">Secret</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(0);
    });

    it('should include elements with data-voice-allow="true" even if denied by global selector', () => {
      document.body.innerHTML = '<button class="internal" data-voice-allow="true">Allowed</button>';
      const result = buildDomIndex(makeConfig({ globalDenySelectors: ['.internal'] }));

      expect(result.targets).toHaveLength(1);
    });

    it('should respect globalDenySelectors', () => {
      document.body.innerHTML = '<button class="admin-only">Admin</button><button>Normal</button>';
      const result = buildDomIndex(makeConfig({ globalDenySelectors: ['.admin-only'] }));

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].normalizedLabel).toBe('normal');
    });
  });

  // --- Risk ---

  describe('risk', () => {
    it('should mark data-voice-risk="high" targets', () => {
      document.body.innerHTML = '<button data-voice-risk="high">Delete All</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets[0].risk).toBe('high');
    });

    it('should not set risk when attribute is absent', () => {
      document.body.innerHTML = '<button>Save</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets[0].risk).toBeUndefined();
    });
  });

  // --- Target IDs ---

  describe('target IDs', () => {
    it('should assign data-voice-id to elements that lack one', () => {
      document.body.innerHTML = '<button>Save</button>';
      buildDomIndex(makeConfig());

      const btn = document.querySelector('button')!;
      expect(btn.getAttribute('data-voice-id')).toBeTruthy();
    });

    it('should preserve existing data-voice-id', () => {
      document.body.innerHTML = '<button data-voice-id="my-id">Save</button>';
      const result = buildDomIndex(makeConfig());

      expect(result.targets[0].id).toBe('my-id');
    });
  });

  // --- Multiple elements ---

  describe('multiple elements', () => {
    it('should index all eligible visible elements', () => {
      document.body.innerHTML = `
        <button>Submit</button>
        <a href="/billing">Billing</a>
        <input type="text" placeholder="Search">
        <div role="tab">Analytics</div>
        <div>Not eligible</div>
      `;
      const result = buildDomIndex(makeConfig());

      expect(result.targets).toHaveLength(4);
      const labels = result.targets.map((t) => t.normalizedLabel);
      expect(labels).toContain('submit');
      expect(labels).toContain('billing');
      expect(labels).toContain('search');
      expect(labels).toContain('analytics');
    });
  });
});
