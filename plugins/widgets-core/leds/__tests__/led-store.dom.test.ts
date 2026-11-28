import { mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import type { LedsStore } from '../data/use-leds.svelte';
import LedStoreProbe from './led-store-probe.svelte';

describe('LED chip power memory', () => {
  it('restores each selected pixel after the off status arrives', async () => {
    const id = 'neopixel test';
    const commands: string[] = [];
    const subscription = { publish: null as ((status: unknown) => void) | null };
    const initial = { [id]: { color_data: [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0]] } };
    const handle = {
      request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'printer.objects.list') return { objects: [id] };
        if (method === 'printer.objects.query' && 'configfile' in (params?.objects as object)) {
          return { status: { configfile: { settings: { [id]: { chain_count: 3 } } } } };
        }
        if (method === 'printer.objects.query') return { status: initial };
        if (method === 'printer.gcode.script') {
          commands.push(params?.script as string);
          return {};
        }
        return {};
      }),
      subscribe: vi.fn((_objects: unknown, callback: (status: unknown) => void) => {
        subscription.publish = callback;
        callback(initial);
        return () => {};
      }),
      onReady: () => () => {},
      onNotify: () => () => {},
    };
    const api = {
      printer: { id: 'led-power-memory-test' },
      moonrakerFor: () => handle,
      settingsFor: () => ({ get: () => null, onChange: () => () => {} }),
      onPrintersChange: () => () => {},
    } as unknown as PluginApi;
    let store: LedsStore | null = null;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(LedStoreProbe, { target, props: { api, onStore: (value: LedsStore) => { store = value; } } });
    try {
      await vi.waitFor(() => expect(store?.items).toHaveLength(1));
      store!.toggleSelection(id, [0, 2]);
      expect(commands.at(-1)).toContain('INDEX=1 TRANSMIT=0');
      expect(commands.at(-1)).toContain('INDEX=3 TRANSMIT=1');

      // Klipper reports the off state before the next power press.
      subscription.publish?.({ [id]: { color_data: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] } });
      store!.toggleSelection(id, [0, 2]);
      expect(commands.at(-1)).toContain('RED=1 GREEN=0 BLUE=0 INDEX=1 TRANSMIT=0');
      expect(commands.at(-1)).toContain('RED=0 GREEN=0 BLUE=1 INDEX=3 TRANSMIT=1');
      expect(commands.at(-1)).not.toContain('INDEX=2');
    } finally {
      unmount(component);
      target.remove();
    }
  });
});
