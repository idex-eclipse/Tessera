import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HeatersHealthSection from '../components/fleet/HeatersHealthSection.svelte';
import { clearHeaterAlerts, publishHeaterAlert } from '../data/heater-alerts.svelte.ts';

vi.mock('../../../plugin-sdk/src/svelte/index', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const TARGET_ALERT = {
  printerId: 'target',
  heaterId: 'extruder',
  displayName: 'Extruder',
  deviation: 6.2,
  target: 200,
};

afterEach(() => {
  clearHeaterAlerts('target');
  clearHeaterAlerts('other');
});

describe('heaters Fleet Health contribution', () => {
  it('lists only the target printer alerts and reports a critical count', async () => {
    publishHeaterAlert(TARGET_ALERT);
    publishHeaterAlert({ ...TARGET_ALERT, printerId: 'other', displayName: 'Other Heater' });
    const target = document.createElement('div');
    const reports: Array<{ severity: string; count: number }> = [];
    target.addEventListener('mpu:fleet-health-report', (event) => {
      reports.push((event as CustomEvent<{ severity: string; count: number }>).detail);
    });
    document.body.append(target);
    const component = mount(HeatersHealthSection, {
      target,
      props: { mpuParams: { printerId: 'target' } },
    });
    try {
      await Promise.resolve();
      flushSync();
      expect(target.textContent).toContain('Extruder');
      expect(target.textContent).not.toContain('Other Heater');
      expect(target.textContent).toContain('calibrations.fleet.deviationRow');
      expect(target.textContent).toContain('calibrations.fleet.pidHint');
      // Navigation rows are buttons; the section stays free of command controls.
      expect(target.querySelector('input, select')).toBeNull();
      expect(reports.at(-1)).toEqual({ severity: 'crit', count: 1 });
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('renders nothing and reports no alert when the printer is healthy', async () => {
    const target = document.createElement('div');
    const reports: Array<{ severity: string; count: number }> = [];
    target.addEventListener('mpu:fleet-health-report', (event) => {
      reports.push((event as CustomEvent<{ severity: string; count: number }>).detail);
    });
    document.body.append(target);
    const component = mount(HeatersHealthSection, {
      target,
      props: { mpuParams: { printerId: 'target' } },
    });
    try {
      await Promise.resolve();
      flushSync();
      expect(target.querySelector('ul')).toBeNull();
      expect(reports.at(-1)).toEqual({ severity: 'none', count: 0 });
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('drops back to a clean report when the last alert recovers', async () => {
    publishHeaterAlert(TARGET_ALERT);
    const target = document.createElement('div');
    const reports: Array<{ severity: string; count: number }> = [];
    target.addEventListener('mpu:fleet-health-report', (event) => {
      reports.push((event as CustomEvent<{ severity: string; count: number }>).detail);
    });
    document.body.append(target);
    const component = mount(HeatersHealthSection, {
      target,
      props: { mpuParams: { printerId: 'target' } },
    });
    try {
      await Promise.resolve();
      flushSync();
      clearHeaterAlerts('target');
      flushSync();
      expect(target.querySelector('ul')).toBeNull();
      expect(reports.at(-1)).toEqual({ severity: 'none', count: 0 });
    } finally {
      unmount(component);
      target.remove();
    }
  });
});
