import { describe, expect, it } from 'vitest';

import type { KlippyState } from '../../shared/klippy-state/use-klippy-state.svelte';
import { buildFleetIndex } from '../fleet-index';

const ids = (klippy: KlippyState, state: string) =>
  buildFleetIndex(klippy, { state, filename: 'part.gcode' }).tags.map((t) => t.id);

describe('buildFleetIndex', () => {
  it.each(['printing', 'paused'])('tags %s as printing and exposes the file name', (state) => {
    const entry = buildFleetIndex('ready', { state, filename: 'part.gcode' });
    expect(entry.tags.map((t) => t.id)).toEqual(['printing']);
    expect(entry.searchText).toBe('part.gcode');
  });

  it.each(['standby', 'complete', 'cancelled', 'error'])(
    'tags print state %s as idle and does not expose the last file name',
    (state) => {
      const entry = buildFleetIndex('ready', { state, filename: 'part.gcode' });
      expect(entry.tags.map((t) => t.id)).toEqual(['idle']);
      expect(entry.searchText).toBe('');
    },
  );

  it.each<KlippyState>(['error', 'shutdown'])(
    'klippy %s is klippy-error regardless of the print state',
    (klippy) => {
      expect(ids(klippy, 'printing')).toEqual(['klippy-error']);
      expect(ids(klippy, 'standby')).toEqual(['klippy-error']);
    },
  );

  it.each<KlippyState>(['startup', 'disconnected', 'unknown'])(
    'klippy %s has no tags and no search text',
    (klippy) => {
      const entry = buildFleetIndex(klippy, { state: 'printing', filename: 'part.gcode' });
      expect(entry).toEqual({ tags: [], searchText: '' });
    },
  );

  it('uses tag ids and label keys that exist in both locales', async () => {
    const { en } = await import('../i18n/locales/en');
    const { ru } = await import('../i18n/locales/ru');
    for (const dict of [en, ru]) {
      expect(Object.keys(dict.fleet.filter).sort()).toEqual(['idle', 'klippyError', 'printing']);
    }
  });
});
