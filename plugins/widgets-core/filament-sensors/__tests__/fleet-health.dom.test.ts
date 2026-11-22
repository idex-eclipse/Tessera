import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
import { clearFilamentAlerts, setFilamentAlerts } from '../data/filament-alerts.svelte.ts';
import FilamentHealthSection from '../components/fleet/FilamentHealthSection.svelte';

const fixture = vi.hoisted(() => ({
  ready: true,
  sensor: { id: 'filament_switch_sensor runout', kind: 'switch', name: 'runout' } as const,
}));

vi.mock('../../../../plugin-sdk/src/svelte/index', () => ({
  useWidget: () => null,
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../shared/klippy-state/use-klippy-state.svelte.ts', () => ({
  useKlippyState: () => fixture,
}));

vi.mock('../data/use-filament.svelte.ts', () => ({
  useFilament: () => ({
    sensors: [fixture.sensor],
    states: {
      [fixture.sensor.id]: {
        enabled: true, detected: false, isActive: false,
        flowComp: false, diameter: null, raw: null,
      },
    },
  }),
}));

afterEach(() => {
  clearFilamentAlerts('target');
  fixture.ready = true;
});

describe('filament Fleet Health contribution', () => {
  it('shows only target-printer readings and reports a critical count without controls', async () => {
    setFilamentAlerts('target', [fixture.sensor.id]);
    const target = document.createElement('div');
    const reports: Array<{ severity: string; count: number }> = [];
    target.addEventListener('mpu:fleet-health-report', (event) => {
      reports.push((event as CustomEvent<{ severity: string; count: number }>).detail);
    });
    document.body.append(target);
    const component = mount(FilamentHealthSection, {
      target,
      props: { mpuApi: {} as PluginApi, mpuParams: { printerId: 'target' } },
    });
    try {
      await Promise.resolve();
      flushSync();
      expect(target.textContent).toContain('runout');
      expect(target.textContent).toContain('widgets.filament.empty');
      expect(target.querySelector('.status.critical')).not.toBeNull();
      expect(target.querySelector('button, input, select')).toBeNull();
      expect(reports.at(-1)).toEqual({ severity: 'crit', count: 1 });
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('keeps an unavailable printer read-only and reports no alarm', async () => {
    fixture.ready = false;
    const target = document.createElement('div');
    const reports: Array<{ severity: string; count: number }> = [];
    target.addEventListener('mpu:fleet-health-report', (event) => {
      reports.push((event as CustomEvent<{ severity: string; count: number }>).detail);
    });
    document.body.append(target);
    const component = mount(FilamentHealthSection, {
      target,
      props: { mpuApi: {} as PluginApi, mpuParams: { printerId: 'target' } },
    });
    try {
      await Promise.resolve();
      flushSync();
      expect(target.textContent).toContain('fleet.filament.notReady');
      expect(reports.at(-1)).toEqual({ severity: 'none', count: 0 });
    } finally {
      unmount(component);
      target.remove();
    }
  });
});
