import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import {
  getCurrentPath,
  getSearch,
  getSort,
  getVisibleColumns,
  setCurrentPath,
  setSearch,
  setSort,
  setVisibleColumns,
} from '../file-table-state.svelte';

/** Minimal per-printer settings implementation records the namespace selected by FileTable. */
function setup() {
  const values = new Map<string, unknown>();
  const settingsFor = vi.fn((printerId: string) => ({
    get: <T>(key: string) => values.get(`${printerId}:${key}`) as T | undefined,
    set: (key: string, value: unknown) => { values.set(`${printerId}:${key}`, value); },
    onChange: () => () => {},
  }));
  const api = {
    printer: { id: 'active' },
    settingsFor,
  } as unknown as PluginApi;
  return { api, values, settingsFor };
}

describe('FileTable fixed printer state', () => {
  it('isolates transient navigation and search state from the active printer', () => {
    const { api } = setup();
    setSearch(api, 'fleet:gcodes', 'target search', 'target');
    setCurrentPath(api, 'fleet:gcodes', 'folder', 'target');
    setSearch(api, 'fleet:gcodes', 'active search');

    expect(getSearch(api, 'fleet:gcodes', 'target')).toBe('target search');
    expect(getCurrentPath(api, 'fleet:gcodes', 'target')).toBe('folder');
    expect(getSearch(api, 'fleet:gcodes')).toBe('active search');
  });

  it('reads and writes columns and sorting in the fixed printer namespace', () => {
    const { api, values, settingsFor } = setup();
    setVisibleColumns(api, 'fleet:gcodes', ['name', 'size'], 'target');
    setSort(api, 'fleet:gcodes', 'name', 1, 'target');
    api.printer.id = 'other';

    expect(getVisibleColumns(api, 'fleet:gcodes', ['name', 'size'], ['name'], 'target')).toEqual(['name', 'size']);
    expect(getSort(api, 'fleet:gcodes', 'target')).toEqual({ key: 'name', dir: 1 });
    expect(values.has('other:columns:fleet:gcodes')).toBe(false);
    expect(settingsFor).toHaveBeenCalledWith('target');
  });
});
