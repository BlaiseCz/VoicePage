/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../matcher.js';
import type { DomTarget, VoicePageConfig } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';

// --- Helpers ---

function makeTarget(overrides: Partial<DomTarget> & { normalizedLabel: string }): DomTarget {
  return {
    id: `vp-target-${overrides.normalizedLabel}`,
    element: {} as Element,
    rawLabel: overrides.rawLabel ?? overrides.normalizedLabel,
    normalizedLabel: overrides.normalizedLabel,
    synonyms: overrides.synonyms ?? [],
    risk: overrides.risk,
  };
}

function makeConfig(overrides?: Partial<VoicePageConfig>): VoicePageConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// --- Tests ---

describe('resolveTarget', () => {
  // --- Exact matching ---

  describe('exact matching', () => {
    it('should find unique exact match on normalizedLabel', () => {
      const targets = [makeTarget({ normalizedLabel: 'submit' }), makeTarget({ normalizedLabel: 'cancel' })];
      const result = resolveTarget('submit', targets, makeConfig());

      expect(result.status).toBe('unique');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].type).toBe('exact');
      expect(result.matches[0].target.normalizedLabel).toBe('submit');
      expect(result.matches[0].score).toBe(1.0);
    });

    it('should find exact match via synonym', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'billing', synonyms: ['invoices', 'payments'] }),
        makeTarget({ normalizedLabel: 'settings' }),
      ];
      const result = resolveTarget('invoices', targets, makeConfig());

      expect(result.status).toBe('unique');
      expect(result.matches[0].target.normalizedLabel).toBe('billing');
    });

    it('should normalize transcript before matching', () => {
      const targets = [makeTarget({ normalizedLabel: 'submit' })];
      const result = resolveTarget('  Submit  ', targets, makeConfig());

      expect(result.status).toBe('unique');
      expect(result.matches[0].target.normalizedLabel).toBe('submit');
    });

    it('should return ambiguous for multiple exact matches with disambiguate policy', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete', id: 'vp-1' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-2' }),
      ];
      const result = resolveTarget('delete', targets, makeConfig({ collisionPolicy: 'disambiguate' }));

      expect(result.status).toBe('ambiguous');
      expect(result.matches).toHaveLength(2);
    });

    it('should return misconfiguration for multiple exact matches with error policy', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete', id: 'vp-1' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-2' }),
      ];
      const result = resolveTarget('delete', targets, makeConfig({ collisionPolicy: 'error' }));

      expect(result.status).toBe('misconfiguration');
    });
  });

  // --- Fuzzy matching ---

  describe('fuzzy matching', () => {
    it('should fuzzy match a typo', () => {
      const targets = [makeTarget({ normalizedLabel: 'submit' }), makeTarget({ normalizedLabel: 'cancel' })];
      // 'submti' vs 'submit': Levenshtein distance 2, maxLen 6, similarity = 0.667
      const result = resolveTarget('submti', targets, makeConfig({ fuzzyThreshold: 0.6 }));

      expect(result.status).toBe('unique');
      expect(result.matches[0].type).toBe('fuzzy');
      expect(result.matches[0].target.normalizedLabel).toBe('submit');
    });

    it('should return no_match when nothing is close enough', () => {
      const targets = [makeTarget({ normalizedLabel: 'submit' }), makeTarget({ normalizedLabel: 'cancel' })];
      const result = resolveTarget('xyzzy', targets, makeConfig());

      expect(result.status).toBe('no_match');
      expect(result.matches).toHaveLength(0);
    });

    it('should pick the best fuzzy match when margin is sufficient', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'submit' }),
        makeTarget({ normalizedLabel: 'summit' }),
        makeTarget({ normalizedLabel: 'cancel' }),
      ];
      // 'submi' vs 'submit' (dist 1, sim 0.833), vs 'summit' (dist 2, sim 0.667)
      // margin = 0.833 - 0.667 = 0.166, which exceeds fuzzyMargin 0.1
      const result = resolveTarget('submi', targets, makeConfig({ fuzzyThreshold: 0.5, fuzzyMargin: 0.1 }));

      expect(result.status).toBe('unique');
      expect(result.matches[0].target.normalizedLabel).toBe('submit');
    });

    it('should return ambiguous when top fuzzy matches are too close', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'bat' }),
        makeTarget({ normalizedLabel: 'cat' }),
      ];
      // "hat" is equidistant from both
      const result = resolveTarget('hat', targets, makeConfig({ fuzzyThreshold: 0.3, fuzzyMargin: 0.5 }));

      expect(result.status).toBe('ambiguous');
    });

    it('should fuzzy match against synonyms too', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'billing', synonyms: ['invoices'] }),
        makeTarget({ normalizedLabel: 'settings' }),
      ];
      // 'invoicse' vs 'invoices': dist 2, maxLen 8, sim = 0.75
      const result = resolveTarget('invoicse', targets, makeConfig({ fuzzyThreshold: 0.7 }));

      expect(result.status).toBe('unique');
      expect(result.matches[0].target.normalizedLabel).toBe('billing');
    });
  });

  // --- Collision policy: error ---

  describe('collision policy: error', () => {
    it('should detect duplicate labels before matching', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete', id: 'vp-1' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-2' }),
        makeTarget({ normalizedLabel: 'submit' }),
      ];
      // Even searching for "submit", the duplicate "delete" labels trigger misconfiguration
      const result = resolveTarget('submit', targets, makeConfig({ collisionPolicy: 'error' }));

      expect(result.status).toBe('misconfiguration');
      expect(result.details).toBeDefined();
    });

    it('should not flag duplicates in disambiguate mode', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete', id: 'vp-1' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-2' }),
        makeTarget({ normalizedLabel: 'submit' }),
      ];
      const result = resolveTarget('submit', targets, makeConfig({ collisionPolicy: 'disambiguate' }));

      expect(result.status).toBe('unique');
      expect(result.matches[0].target.normalizedLabel).toBe('submit');
    });
  });

  // --- Disambiguation (disambiguate policy) ---

  describe('disambiguation flow', () => {
    it('should return all duplicate exact matches as candidates', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete', id: 'vp-del-1' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-del-2' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-del-3' }),
      ];
      const result = resolveTarget('delete', targets, makeConfig({ collisionPolicy: 'disambiguate' }));

      expect(result.status).toBe('ambiguous');
      expect(result.matches).toHaveLength(3);
      expect(result.matches.every((m) => m.type === 'exact')).toBe(true);
      expect(result.matches.every((m) => m.score === 1.0)).toBe(true);
    });

    it('should still resolve unique matches even with other duplicates present', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete', id: 'vp-del-1' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-del-2' }),
        makeTarget({ normalizedLabel: 'submit', id: 'vp-submit' }),
      ];
      const result = resolveTarget('submit', targets, makeConfig({ collisionPolicy: 'disambiguate' }));

      expect(result.status).toBe('unique');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].target.id).toBe('vp-target-submit');
    });

    it('should return ambiguous for duplicate synonym matches', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'billing page', id: 'vp-1', synonyms: ['invoices'] }),
        makeTarget({ normalizedLabel: 'invoice list', id: 'vp-2', synonyms: ['invoices'] }),
      ];
      const result = resolveTarget('invoices', targets, makeConfig({ collisionPolicy: 'disambiguate' }));

      expect(result.status).toBe('ambiguous');
      expect(result.matches).toHaveLength(2);
    });

    it('should return ambiguous when one match is via label and another via synonym', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'invoices', id: 'vp-1' }),
        makeTarget({ normalizedLabel: 'billing', id: 'vp-2', synonyms: ['invoices'] }),
      ];
      const result = resolveTarget('invoices', targets, makeConfig({ collisionPolicy: 'disambiguate' }));

      expect(result.status).toBe('ambiguous');
      expect(result.matches).toHaveLength(2);
    });

    it('should return misconfiguration for duplicates with error policy even when searching different term', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete', id: 'vp-del-1' }),
        makeTarget({ normalizedLabel: 'delete', id: 'vp-del-2' }),
        makeTarget({ normalizedLabel: 'submit', id: 'vp-submit' }),
      ];
      // error policy checks for ANY duplicates before matching
      const result = resolveTarget('submit', targets, makeConfig({ collisionPolicy: 'error' }));

      expect(result.status).toBe('misconfiguration');
    });

    it('should return ambiguous for close fuzzy matches in disambiguate mode', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'delete item', id: 'vp-1' }),
        makeTarget({ normalizedLabel: 'delete user', id: 'vp-2' }),
      ];
      // "delete" is fuzzy-close to both; margin between them should be small
      const result = resolveTarget('delete', targets, makeConfig({
        collisionPolicy: 'disambiguate',
        fuzzyThreshold: 0.5,
        fuzzyMargin: 0.5,
      }));

      expect(result.status).toBe('ambiguous');
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should handle empty targets array', () => {
      const result = resolveTarget('anything', [], makeConfig());
      expect(result.status).toBe('no_match');
    });

    it('should handle empty transcript', () => {
      const targets = [makeTarget({ normalizedLabel: 'submit' })];
      const result = resolveTarget('', targets, makeConfig());
      expect(result.status).toBe('no_match');
    });

    it('should prefer exact over fuzzy', () => {
      const targets = [
        makeTarget({ normalizedLabel: 'submit' }),
        makeTarget({ normalizedLabel: 'submits' }),
      ];
      const result = resolveTarget('submit', targets, makeConfig());

      expect(result.status).toBe('unique');
      expect(result.matches[0].type).toBe('exact');
      expect(result.matches[0].target.normalizedLabel).toBe('submit');
    });
  });
});
