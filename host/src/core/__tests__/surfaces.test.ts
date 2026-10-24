import { describe, expect, it } from 'vitest';

import type { PluginManifest } from '../../../../plugin-sdk/src/types';
import {
  SURFACE_KINDS,
  SURFACE_SPECS,
  contributionsOf,
  hasPersistentSurfaces,
} from '../surfaces';

const base: PluginManifest = { id: 'p', name: 'p', version: '1.0.0', entry: 'index.js' };

describe('surfaces', () => {
  it('every kind has a spec; persistent kinds have a validator', () => {
    for (const kind of SURFACE_KINDS) {
      const spec = SURFACE_SPECS[kind];
      expect(spec.label).toBeTruthy();
      if (spec.persistent) expect(spec.validate).toBeTypeOf('function');
    }
  });

  it('validators require non-empty strings', () => {
    const overlay = SURFACE_SPECS.overlays.validate!;
    expect(overlay({ id: 'a', element: 'x-a' })).toBe(true);
    expect(overlay({ id: '', element: 'x-a' })).toBe(false);
    expect(overlay({ id: 'a' })).toBe(false);
    expect(overlay(null)).toBe(false);

    const chip = SURFACE_SPECS.chips.validate!;
    expect(chip({ type: 't', provider: 'p', titleKey: 'k', element: 'e', pickerElement: 'pe' })).toBe(true);
    expect(chip({ type: 't', provider: 'p', titleKey: 'k', element: 'e' })).toBe(false);
  });

  it('contributionsOf returns [] for missing kinds', () => {
    expect(contributionsOf(base, 'banners')).toEqual([]);
  });

  it('hasPersistentSurfaces covers lists and rightPanel, but not pages/widgets', () => {
    expect(hasPersistentSurfaces(base)).toBe(false);
    expect(hasPersistentSurfaces({ ...base, pages: [{ id: 'p', titleKey: 'k', element: 'e' }] })).toBe(false);
    expect(hasPersistentSurfaces({ ...base, banners: [{ id: 'b', element: 'e' }] })).toBe(true);
    expect(hasPersistentSurfaces({ ...base, rightPanel: { id: 'r', element: 'e' } })).toBe(true);
  });
});
