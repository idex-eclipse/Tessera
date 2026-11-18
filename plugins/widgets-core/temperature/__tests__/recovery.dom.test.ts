import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import TemperatureRecoveryProbe from './TemperatureRecoveryProbe.svelte';

/** An empty history after startup must still produce a live sensor subscription. */
describe('temperature recovery after Klipper startup', () => {
  it('discovers sensors from loaded objects when temperature history is empty', async () => {
    const subscribe = vi.fn((_objects: Record<string, string[]>, callback: (delta: unknown) => void) => {
      callback({ extruder: { temperature: 24 } });
      return () => {};
    });
    const request = vi.fn(async (method: string) => {
      if (method === 'server.info') return { klippy_state: 'ready' };
      if (method === 'server.temperature_store') return {};
      if (method === 'printer.objects.list') return { objects: ['extruder', 'toolhead'] };
      if (method === 'printer.objects.query') return { status: { configfile: { settings: {} } } };
      throw new Error(`Unexpected request: ${method}`);
    });
    const api = {
      settingsFor: () => ({ get: () => undefined, onChange: () => () => {} }),
      moonrakerFor: () => ({ readyState: 'open', request, subscribe,
        onReady: () => () => {}, onNotify: () => () => {},
        onConnectionStatusChange: () => () => {} }),
      onPrintersChange: () => () => {},
    } as unknown as PluginApi;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(TemperatureRecoveryProbe, {
      target,
      props: { api, printerId: 'temperature-recovery-empty-history' },
    });

    try {
      await vi.waitFor(() => {
        flushSync();
        expect(subscribe).toHaveBeenCalledWith(
          { extruder: ['temperature', 'target', 'power'], print_stats: ['state'] },
          expect.any(Function),
          { immediate: true },
        );
        expect(target.textContent).toBe('24');
      });
    } finally {
      unmount(component);
      target.remove();
    }
  });
});
