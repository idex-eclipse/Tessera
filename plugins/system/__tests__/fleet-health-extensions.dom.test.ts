import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtensionRef, PluginApi } from '../../../plugin-sdk/src/types';
import HealthPanel from '../components/fleet/HealthPanel.svelte';

const state = vi.hoisted(() => ({
  health: {
    klippyReady: true,
    throttle: { supported: false, bits: 0, now: [], past: [], severity: 'unknown' },
    cpuTemp: null as number | null,
    failedComponents: [] as string[],
    warnings: [] as string[],
    mcus: [],
    tmc: [],
  },
}));

vi.mock('../../../plugin-sdk/src/svelte/index', () => ({
  useWidget: () => null,
  useI18n: () => ({
    locale: 'en',
    t: (key: string, params?: Record<string, string | number>) => params
      ? `${key}:${Object.values(params).join(':')}`
      : key,
  }),
}));

vi.mock('../data/use-health.svelte.ts', () => ({
  useHealth: () => state.health,
}));

type Report = { severity: 'none' | 'warn' | 'crit'; count: number };

/** Mounts Fleet Health with one fake extension contribution and exposes its report emitter. */
async function setup(initial: Report) {
  const listeners = new Set<() => void>();
  let refs: ExtensionRef[] = [{
    ref: 'tessera/maintenance/fleet-health',
    pluginId: 'tessera/maintenance',
    kind: 'element',
    title: 'Maintenance',
    order: 0,
  }];
  const extensionElement = { current: null as HTMLElement | null };
  const destroy = vi.fn();
  const list = vi.fn((_point: string, _params?: Record<string, string>) => refs);
  const mountExtension = vi.fn((node: HTMLElement, _ref: string, _params?: Record<string, string>) => {
    extensionElement.current = document.createElement('maintenance-probe');
    extensionElement.current.textContent = 'Maintenance section';
    node.append(extensionElement.current);
    return {
      update: vi.fn(),
      destroy: () => {
        extensionElement.current?.remove();
        destroy();
      },
    };
  });
  const api = {
    printer: { id: 'active', name: 'Active' },
    extensions: {
      list,
      onChange: (cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      mount: mountExtension,
    },
  } as unknown as PluginApi;
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(HealthPanel, {
    target,
    props: { mpuApi: api, mpuParams: { printerId: 'target' } },
  });
  await Promise.resolve();
  flushSync();
  extensionElement.current?.dispatchEvent(new CustomEvent('mpu:fleet-health-report', {
    bubbles: true,
    composed: true,
    detail: initial,
  }));
  flushSync();

  return {
    target,
    list,
    mountExtension,
    destroy,
    emit(detail: unknown): void {
      extensionElement.current?.dispatchEvent(new CustomEvent('mpu:fleet-health-report', {
        bubbles: true,
        composed: true,
        detail,
      }));
      flushSync();
    },
    removeExtension(): void {
      refs = [];
      for (const listener of listeners) listener();
      flushSync();
    },
    stop(): void {
      unmount(component);
      target.remove();
    },
  };
}

beforeEach(() => {
  state.health.klippyReady = true;
  state.health.cpuTemp = null;
  state.health.failedComponents = [];
  state.health.warnings = [];
});

describe('fleet health extension sections', () => {
  it('mounts before opening, passes printerId, and aggregates a warning report', async () => {
    const view = await setup({ severity: 'warn', count: 2 });
    try {
      expect(view.list).toHaveBeenCalledWith('fleet-health-sections', { printerId: 'target' });
      expect(view.mountExtension).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'tessera/maintenance/fleet-health',
        { printerId: 'target' },
      );
      expect(view.target.querySelector('.fh-popover')?.hasAttribute('hidden')).toBe(true);
      expect(view.target.querySelector('.chip.warn')).not.toBeNull();
      expect((view.target.querySelector('.fh-indicator') as HTMLButtonElement).title).toContain(':2:0');
      expect(view.target.textContent).not.toContain('fleet.health.ok');

      (view.target.querySelector('.fh-indicator') as HTMLButtonElement).click();
      flushSync();
      expect(view.target.querySelector('.fh-popover')?.hasAttribute('hidden')).toBe(false);
      expect(view.target.textContent).toContain('Maintenance section');
    } finally {
      view.stop();
    }
  });

  it('keeps a core critical issue above an extension warning', async () => {
    state.health.failedComponents = ['database'];
    const view = await setup({ severity: 'warn', count: 1 });
    try {
      expect(view.target.querySelector('.chip.crit')).not.toBeNull();
      expect((view.target.querySelector('.fh-indicator') as HTMLButtonElement).title).toContain(':2:1');
    } finally {
      view.stop();
    }
  });

  it('clears malformed and unmounted provider state and logs malformed payloads once', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = await setup({ severity: 'warn', count: 1 });
    try {
      view.emit({ severity: 'warn', count: 0 });
      view.emit({ severity: 'bogus', count: 4 });
      expect(view.target.querySelector('.chip.ok')).not.toBeNull();
      expect(warning).toHaveBeenCalledTimes(1);

      view.emit({ severity: 'warn', count: 1 });
      expect(view.target.querySelector('.chip.warn')).not.toBeNull();
      view.removeExtension();
      expect(view.destroy).toHaveBeenCalledTimes(1);
      expect(view.target.querySelector('.chip.ok')).not.toBeNull();
    } finally {
      warning.mockRestore();
      view.stop();
    }
  });
});
