import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSettingsStore } from '../settings-store.svelte.ts';
import { setPluginSynced } from '../settings-sync.svelte.ts';
import { MemoryStorage } from '../storage';

describe('settings-store / sync toggle', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  afterEach(() => {
    setPluginSynced('p1', 'plug', false);
    vi.unstubAllGlobals();
  });

  it('notifies a subscriber once, however many writes happened before', () => {
    const store = createSettingsStore({ storage: new MemoryStorage() });
    const onChange = vi.fn();
    store.onPluginSettingsChange('p1', 'plug', onChange);

    store.patchPluginSettings('p1', 'plug', { a: 1 });
    store.patchPluginSettings('p1', 'plug', { a: 2 });
    store.patchPluginSettings('p1', 'plug', { a: 3 });
    onChange.mockClear();

    setPluginSynced('p1', 'plug', true);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('notifies a subscriber even if nothing was written in this session', () => {
    const store = createSettingsStore({ storage: new MemoryStorage() });
    const onChange = vi.fn();
    store.onPluginSettingsChange('p1', 'plug', onChange);

    setPluginSynced('p1', 'plug', true);

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
