import { describe, expect, it } from 'vitest';

import { DEFAULT_FIELDS, parseEnabledFields } from '../data/use-print-status.svelte';

describe('parseEnabledFields', () => {
  it('shows every field when nothing valid is stored', () => {
    expect(parseEnabledFields(undefined)).toEqual(DEFAULT_FIELDS);
    expect(parseEnabledFields('speed')).toEqual(DEFAULT_FIELDS);
    expect(parseEnabledFields({})).toEqual(DEFAULT_FIELDS);
  });

  it('keeps an explicit empty list (the user switched everything off)', () => {
    expect(parseEnabledFields([])).toEqual([]);
  });

  it('drops unknown ids and restores the canonical order', () => {
    expect(parseEnabledFields(['eta', 'bogus', 'speed'])).toEqual(['speed', 'eta']);
  });

  it('returns a fresh array so callers cannot mutate the defaults', () => {
    expect(parseEnabledFields(undefined)).not.toBe(DEFAULT_FIELDS);
  });
});
