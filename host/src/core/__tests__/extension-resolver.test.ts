import { describe, expect, it } from 'vitest';

import type { ExtensionContribution, ExtensionPointDecl } from '../../../../plugin-sdk/src/types';
import {
  buildExtensionGraph,
  extensionRef,
  parseExtensionRef,
  resolvePointState,
  type ExtensionResolution,
} from '../extension-resolver';
import type { RegisteredExtension, RegisteredExtensionPoint } from '../surfaces';

const OWNER = '@core/calibrations';

function point(decl: Partial<ExtensionPointDecl> & { id: string }): RegisteredExtensionPoint {
  return { pluginId: OWNER, contribution: { kind: 'tab', version: 1, ...decl } };
}

function ext(
  pluginId: string,
  c: Partial<ExtensionContribution> & { id: string; point: string },
): RegisteredExtension {
  return {
    pluginId,
    contribution: { kind: 'tab', version: 1, titleKey: 't', element: 'x-el', ...c },
  };
}

function graph(
  points: RegisteredExtensionPoint[],
  extensions: RegisteredExtension[],
  opts: { applies?: (id: string) => boolean; resolutions?: Record<string, ExtensionResolution> } = {},
) {
  return buildExtensionGraph({
    points,
    extensions,
    applies: opts.applies ?? (() => true),
    resolutions: opts.resolutions ?? {},
  });
}

const all = () => true;

describe('extension refs', () => {
  it('parses refs of scoped plugin ids by the last slash', () => {
    expect(parseExtensionRef('@acme/st/shaketune')).toEqual({ pluginId: '@acme/st', id: 'shaketune' });
    expect(parseExtensionRef('noslash')).toBeNull();
    expect(parseExtensionRef('@acme/st/')).toBeNull();
  });
});

describe('buildExtensionGraph', () => {
  it('binds an extension to its point', () => {
    const g = graph([point({ id: 'tabs' })], [ext('a', { id: 'x', point: `${OWNER}#tabs` })]);
    expect(g.points.get(`${OWNER}#tabs`)?.enabled.map(extensionRef)).toEqual(['a/x']);
  });

  it('keeps extensions of a missing point or owner sleeping', () => {
    const e1 = ext('a', { id: 'x', point: `${OWNER}#nope` });
    const e2 = ext('a', { id: 'y', point: '@other/plugin#tabs' });
    const g = graph([point({ id: 'tabs' })], [e1, e2]);
    expect(g.sleeping).toEqual([e1, e2]);
    expect(g.rejected).toEqual([]);
  });

  it('rejects kind and version mismatches and duplicates', () => {
    const e1 = ext('a', { id: 'k', point: `${OWNER}#tabs`, kind: 'panel' });
    const e2 = ext('a', { id: 'v', point: `${OWNER}#tabs`, version: 2 });
    const e3 = ext('a', { id: 'ok', point: `${OWNER}#tabs` });
    const e4 = ext('a', { id: 'ok', point: `${OWNER}#tabs` });
    const g = graph([point({ id: 'tabs' })], [e1, e2, e3, e4]);
    expect(g.rejected.map((r) => r.reason)).toEqual(['kind-mismatch', 'version-mismatch', 'duplicate']);
    expect(g.points.get(`${OWNER}#tabs`)?.enabled).toEqual([e3]);
  });

  it('skips plugins that do not apply to the printer', () => {
    const g = graph(
      [point({ id: 'tabs' })],
      [ext('a', { id: 'x', point: `${OWNER}#tabs` }), ext('b', { id: 'y', point: `${OWNER}#tabs` })],
      { applies: (id) => id === 'b' },
    );
    expect(g.points.get(`${OWNER}#tabs`)?.enabled.map(extensionRef)).toEqual(['b/y']);
  });

  it('orders by order, then by registration', () => {
    const g = graph(
      [point({ id: 'tabs' })],
      [
        ext('a', { id: '1', point: `${OWNER}#tabs`, order: 5 }),
        ext('b', { id: '2', point: `${OWNER}#tabs` }),
        ext('c', { id: '3', point: `${OWNER}#tabs` }),
      ],
    );
    expect(g.points.get(`${OWNER}#tabs`)?.enabled.map(extensionRef)).toEqual(['b/2', 'c/3', 'a/1']);
  });

  describe('conflicts', () => {
    const replace = point({ id: 'chart', kind: 'element', mode: 'replacement' });
    const r1 = ext('a', { id: 'x', point: `${OWNER}#chart`, kind: 'element' });
    const r2 = ext('b', { id: 'y', point: `${OWNER}#chart`, kind: 'element' });

    it('raises a conflict above capacity and disables all candidates', () => {
      const p = graph([replace], [r1, r2]).points.get(`${OWNER}#chart`)!;
      expect(p.conflict).toBe(true);
      expect(p.enabled).toEqual([]);
      expect(p.candidates).toHaveLength(2);
    });

    it('applies a resolution for the same candidate set', () => {
      const p = graph([replace], [r1, r2], {
        resolutions: { [`${OWNER}#chart`]: { winners: ['b/y'], candidates: ['a/x', 'b/y'] } },
      }).points.get(`${OWNER}#chart`)!;
      expect(p.conflict).toBe(false);
      expect(p.enabled).toEqual([r2]);
    });

    it('accepts "keep the original" (no winners)', () => {
      const p = graph([replace], [r1, r2], {
        resolutions: { [`${OWNER}#chart`]: { winners: [], candidates: ['b/y', 'a/x'] } },
      }).points.get(`${OWNER}#chart`)!;
      expect(p.conflict).toBe(false);
      expect(p.enabled).toEqual([]);
    });

    it('raises the conflict again when the candidate set changes', () => {
      const r3 = ext('c', { id: 'z', point: `${OWNER}#chart`, kind: 'element' });
      const p = graph([replace], [r1, r2, r3], {
        resolutions: { [`${OWNER}#chart`]: { winners: ['b/y'], candidates: ['a/x', 'b/y'] } },
      }).points.get(`${OWNER}#chart`)!;
      expect(p.conflict).toBe(true);
    });

    it('uses max as capacity of append points', () => {
      const p1 = point({ id: 'side', kind: 'panel', max: 1 });
      const p = graph(
        [p1],
        [
          ext('a', { id: 'x', point: `${OWNER}#side`, kind: 'panel' }),
          ext('b', { id: 'y', point: `${OWNER}#side`, kind: 'panel' }),
        ],
      ).points.get(`${OWNER}#side`)!;
      expect(p.conflict).toBe(true);
    });

    it('never conflicts in alternative mode', () => {
      const alt = point({ id: 'shaper', mode: 'alternative' });
      const p = graph(
        [alt],
        [ext('a', { id: 'x', point: `${OWNER}#shaper` }), ext('b', { id: 'y', point: `${OWNER}#shaper` })],
      ).points.get(`${OWNER}#shaper`)!;
      expect(p.conflict).toBe(false);
      expect(p.enabled).toHaveLength(2);
    });
  });
});

describe('resolvePointState', () => {
  const alt = (decl: Partial<ExtensionPointDecl> = {}) =>
    graph(
      [point({ id: 'shaper', mode: 'alternative', ...decl })],
      [ext('a', { id: 'x', point: `${OWNER}#shaper` }), ext('b', { id: 'y', point: `${OWNER}#shaper` })],
    ).points.get(`${OWNER}#shaper`);

  it('shows only the original for an undeclared point', () => {
    expect(resolvePointState(undefined, { choice: undefined, isAvailable: all })).toEqual({
      original: true, active: [], options: [], conflict: false,
    });
  });

  it('append keeps the original and shows available extensions', () => {
    const p = graph(
      [point({ id: 'tabs' })],
      [ext('a', { id: 'x', point: `${OWNER}#tabs` }), ext('b', { id: 'y', point: `${OWNER}#tabs` })],
    ).points.get(`${OWNER}#tabs`);
    const s = resolvePointState(p, { choice: undefined, isAvailable: (e) => e.pluginId === 'b' });
    expect(s.original).toBe(true);
    expect(s.active.map(extensionRef)).toEqual(['b/y']);
  });

  it('replacement falls back to the original when unavailable', () => {
    const p = graph(
      [point({ id: 'chart', kind: 'element', mode: 'replacement' })],
      [ext('a', { id: 'x', point: `${OWNER}#chart`, kind: 'element' })],
    ).points.get(`${OWNER}#chart`);
    expect(resolvePointState(p, { choice: undefined, isAvailable: all }).original).toBe(false);
    expect(resolvePointState(p, { choice: undefined, isAvailable: () => false }).original).toBe(true);
  });

  it('alternative defaults to the first available extension', () => {
    const s = resolvePointState(alt(), { choice: undefined, isAvailable: all });
    expect(s.original).toBe(false);
    expect(s.active.map(extensionRef)).toEqual(['a/x']);
    expect(s.options).toHaveLength(2);
  });

  it('alternative honours default: original', () => {
    expect(resolvePointState(alt({ default: 'original' }), { choice: undefined, isAvailable: all }).original).toBe(true);
  });

  it('alternative honours the explicit choice and falls back when it is gone', () => {
    const p = alt();
    expect(resolvePointState(p, { choice: 'b/y', isAvailable: all }).active.map(extensionRef)).toEqual(['b/y']);
    expect(resolvePointState(p, { choice: null, isAvailable: all }).original).toBe(true);
    expect(resolvePointState(p, { choice: 'b/y', isAvailable: (e) => e.pluginId === 'a' }).original).toBe(true);
  });
});
