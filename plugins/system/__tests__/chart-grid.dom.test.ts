import { flushSync, mount, unmount, type Component } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// jsdom implements neither of these: uPlot calls matchMedia while it is imported, and ChartGrid
// observes its chart boxes with ResizeObserver.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} });
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

import type { PluginApi } from '../../../plugin-sdk/src/types';
import ChartGrid from '../components/page/panels/ChartGrid.svelte';
import type { ChartDef } from '../types';
import WithApi from './helpers/WithApi.svelte';

type Pt = { t: number; v: number | null };

/** Client-compiled (jsdom) check that ChartGrid mounts without Svelte warnings. */
describe('ChartGrid (jsdom)', () => {
  it('renders a card per chart that has data, without Svelte warnings', () => {
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: unknown[]) => void warnings.push(a.map(String).join(' '));

    const api = { onThemeChange: () => () => {} } as unknown as PluginApi;
    const charts: ChartDef<Pt>[] = [
      { id: 'a', title: 'A', fixed: false, series: [{ label: 'v', color: '#fff', unit: '', get: (p) => p.v }] },
      { id: 'empty', title: 'Empty', fixed: false, series: [{ label: 'v', color: '#fff', unit: '', get: () => null }] },
    ];
    const target = document.createElement('div');
    document.body.appendChild(target);

    try {
      const c = mount(WithApi, {
        target,
        props: { api, component: ChartGrid as unknown as Component<Record<string, unknown>>, props: { charts, points: [{ t: 1, v: 1 }, { t: 2, v: 2 }] } },
      });
      flushSync();
      expect(target.querySelectorAll('.chart-card')).toHaveLength(1); // the all-null chart is hidden
      unmount(c);
    } finally {
      console.warn = realWarn;
      target.remove();
    }
    expect(warnings.filter((w) => w.includes('binding_property_non_reactive'))).toEqual([]);
  });
});
