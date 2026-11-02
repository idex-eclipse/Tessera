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

    const collapsed = SURFACE_SPECS.collapsedBanners.validate!;
    expect(collapsed({ id: 'a', banner: 'b', element: 'x-a' })).toBe(true);
    expect(collapsed({ id: 'a', element: 'x-a' })).toBe(false);
  });

  it('validates extension points', () => {
    const point = SURFACE_SPECS.extensionPoints.validate!;
    expect(point({ id: 'tabs', kind: 'tab', version: 1 })).toBe(true);
    expect(point({ id: 'shaper', kind: 'tab', mode: 'alternative', version: 1, default: 'original' })).toBe(true);
    expect(point({ id: 'side', kind: 'panel', mode: 'append', version: 2, max: 2 })).toBe(true);
    expect(point({ id: 'x', kind: 'tab' })).toBe(false); // без версии
    expect(point({ id: 'x', kind: 'tab', version: 1.5 })).toBe(false);
    expect(point({ id: 'x', kind: 'menu', version: 1 })).toBe(false);
    expect(point({ id: 'x#y', kind: 'tab', version: 1 })).toBe(false);
    expect(point({ id: 'x', kind: 'action', mode: 'replacement', version: 1 })).toBe(false);
    expect(point({ id: 'x', kind: 'tab', mode: 'replacement', version: 1, max: 2 })).toBe(false);
    expect(point({ id: 'x', kind: 'tab', version: 1, default: 'extension' })).toBe(false);
  });

  it('validates extension contributions', () => {
    const ext = SURFACE_SPECS.extensions.validate!;
    const tab = { point: '@core/calibrations#tabs', kind: 'tab', version: 1, id: 'st', titleKey: 'k', element: 'x-st' };
    expect(ext(tab)).toBe(true);
    expect(ext({ ...tab, point: 'no-hash' })).toBe(false);
    expect(ext({ ...tab, id: 'a/b' })).toBe(false);
    expect(ext({ ...tab, element: undefined })).toBe(false);
    expect(ext({ ...tab, headerElement: 'x-h' })).toBe(false); // только panel
    expect(ext({ ...tab, kind: 'panel', headerElement: 'x-h' })).toBe(true);
    expect(ext({ ...tab, kind: 'action', element: undefined, handler: 'run' })).toBe(true);
    expect(ext({ ...tab, kind: 'action', element: undefined })).toBe(false);
    expect(ext({ ...tab, version: 0 })).toBe(false);
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
