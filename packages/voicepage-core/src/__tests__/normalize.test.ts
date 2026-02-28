/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { normalizeLabel } from '../normalize.js';

describe('normalizeLabel', () => {
  it('should lowercase', () => {
    expect(normalizeLabel('Submit')).toBe('submit');
    expect(normalizeLabel('CANCEL')).toBe('cancel');
  });

  it('should trim leading/trailing whitespace', () => {
    expect(normalizeLabel('  hello  ')).toBe('hello');
    expect(normalizeLabel('\thello\n')).toBe('hello');
  });

  it('should collapse internal whitespace', () => {
    expect(normalizeLabel('open   settings')).toBe('open settings');
    expect(normalizeLabel('my   cool   button')).toBe('my cool button');
  });

  it('should handle combined transforms', () => {
    expect(normalizeLabel('  Open   Settings  ')).toBe('open settings');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeLabel('')).toBe('');
    expect(normalizeLabel('   ')).toBe('');
  });

  it('should preserve special characters', () => {
    expect(normalizeLabel('Save & Close')).toBe('save & close');
    expect(normalizeLabel('Delete (All)')).toBe('delete (all)');
  });
});
