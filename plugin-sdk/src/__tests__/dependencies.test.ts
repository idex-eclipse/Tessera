import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  manifestDependencies,
  parseVersion,
  sanitizeDependencies,
  satisfiesMin,
} from '../dependencies';
import type { PluginManifest } from '../types';

const base: PluginManifest = { id: 'acme/addon', name: 'Addon', version: '1.0.0', entry: 'index.js' };

describe('dependencies', () => {
  it('parses semver', () => {
    expect(parseVersion('3.0.0')).toEqual({ major: 3, minor: 0, patch: 0, prerelease: [] });
    expect(parseVersion('1.2.3-rc.1+build.5')?.prerelease).toEqual(['rc', 1]);
    for (const bad of ['3.0', '03.0.0', 'v3.0.0', '', ' 3.0.0', 3, null, undefined]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it('compares by semver precedence', () => {
    const cmp = (a: string, b: string) => Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!));
    expect(cmp('3.0.0', '2.10.0')).toBe(1);
    expect(cmp('2.10.0', '2.9.9')).toBe(1);
    expect(cmp('3.0.0', '3.0.0+abc')).toBe(0);
    expect(cmp('3.0.0-rc.1', '3.0.0')).toBe(-1);
    expect(cmp('3.0.0-rc.2', '3.0.0-rc.1')).toBe(1);
    expect(cmp('3.0.0-1', '3.0.0-rc')).toBe(-1); // числовой идентификатор раньше строкового
    expect(cmp('3.0.0-rc', '3.0.0-rc.1')).toBe(-1);
  });

  it('checks the minimal version', () => {
    expect(satisfiesMin('3.0.0', '3.0.0')).toBe(true);
    expect(satisfiesMin('3.1.0', '3.0.0')).toBe(true);
    expect(satisfiesMin('2.1.0', '3.0.0')).toBe(false);
    expect(satisfiesMin(undefined, undefined)).toBe(true);
    expect(satisfiesMin('dev', '1.0.0')).toBe(false);
    expect(satisfiesMin(undefined, '1.0.0')).toBe(false);
  });

  it('collects point owners and explicit minimums', () => {
    const deps = manifestDependencies({
      ...base,
      dependencies: { '@core/calibrations': '3.0.0', 'acme/addon': '1.0.0' },
      extensions: [
        { point: '@core/calibrations#panel-probe', kind: 'panel', version: 1, id: 'p', titleKey: 't', element: 'x' },
        { point: 'acme/owner#tabs', kind: 'tab', version: 1, id: 't', titleKey: 't', element: 'x' },
        { point: 'acme/addon#own', kind: 'tab', version: 1, id: 'o', titleKey: 't', element: 'x' },
      ],
    });
    expect(Object.fromEntries(deps)).toEqual({ '@core/calibrations': '3.0.0', 'acme/owner': undefined });
  });

  it('sanitizes manifest.dependencies', () => {
    expect(sanitizeDependencies(undefined)).toEqual({ dependencies: undefined, invalid: [] });
    expect(sanitizeDependencies(['x']).dependencies).toBeUndefined();
    const r = sanitizeDependencies({ a: '1.0.0', b: '1.0', 'c#d': '1.0.0', e: 2 });
    expect(r.dependencies).toEqual({ a: '1.0.0' });
    expect(r.invalid.map(([id]) => id)).toEqual(['b', 'c#d', 'e']);
  });
});
