import { describe, expect, it } from 'vitest';

import { createAccordionState } from '../accordion/use-accordion-state.svelte';

function fakeSettings(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    get: <T>(key: string) => store[key] as T | undefined,
    set: (key: string, value: unknown) => {
      store[key] = value;
    },
  };
}

describe('createAccordionState', () => {
  it('follows the default of the mode until the user toggles', () => {
    const state = createAccordionState(fakeSettings(), 'k');
    expect(state.isOpen('a', false, true)).toBe(true);
    expect(state.isOpen('a', true, false)).toBe(false);
  });

  it('keeps the wide and narrow modes separate', () => {
    const state = createAccordionState(fakeSettings(), 'k');
    state.toggle('a', true, false);
    expect(state.isOpen('a', true, false)).toBe(true);
    expect(state.isOpen('a', false, true)).toBe(true);

    state.toggle('a', false, true);
    expect(state.isOpen('a', false, true)).toBe(false);
    expect(state.isOpen('a', true, false)).toBe(true);
  });

  it('restores the saved state', () => {
    const settings = fakeSettings();
    createAccordionState(settings, 'k').toggle('a', false, true);
    expect(createAccordionState(settings, 'k').isOpen('a', false, true)).toBe(false);
  });

  it('re-reads the settings of another printer on reload', () => {
    const settings = fakeSettings({ k: { wide: { a: false } } });
    const state = createAccordionState(settings, 'k');
    expect(state.isOpen('a', false, true)).toBe(false);

    delete settings.store.k;
    state.reload();
    expect(state.isOpen('a', false, true)).toBe(true);
  });
});
