import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import SystemProbe from './helpers/SystemProbe.svelte';

/** A Moonraker handle whose connection state the test controls. */
function fakeHandle(initial: 'open' | 'closed') {
  const requests: string[] = [];
  const connListeners = new Set<(s: string) => void>();
  const handle = {
    readyState: initial as string,
    requests,
    onReady: () => () => {},
    onNotify: () => () => {},
    poll: () => () => {},
    subscribe: () => () => {},
    onConnectionStatusChange(cb: (s: string) => void) {
      connListeners.add(cb);
      return () => connListeners.delete(cb);
    },
    async request(method: string) {
      requests.push(method);
      if (handle.readyState !== 'open') throw new Error('Moonraker connection is not open');
      return {};
    },
    open() {
      handle.readyState = 'open';
      for (const cb of Array.from(connListeners)) cb('open');
    },
  };
  return handle;
}

// Each test uses its own printer id: the keeper keeps cores alive between tests.
function mountSystem(handle: ReturnType<typeof fakeHandle>, pid: string) {
  const api = {
    printer: { id: pid, url: 'http://x' },
    moonrakerFor: () => handle,
    moonraker: () => handle,
    onPrintersChange: () => () => {},
    onPrinterChange: () => () => {},
    settings: { get: () => undefined, set() {}, onChange: () => () => {} },
    settingsFor: () => ({ get: () => undefined, set() {}, onChange: () => () => {} }),
  } as unknown as PluginApi;

  const target = document.createElement('div');
  document.body.appendChild(target);
  const c = mount(SystemProbe, { target, props: { api, printerId: pid, expose: () => {} } });
  flushSync();
  return () => {
    unmount(c);
    target.remove();
  };
}

describe('System core and the Moonraker connection', () => {
  it('does not load (or log an error) while the connection is closed, and loads once it opens', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = fakeHandle('closed');
    const stop = mountSystem(handle, 'closed-1');
    try {
      await vi.waitFor(() => expect(handle.requests).toEqual([])); // nothing was even attempted
      expect(error).not.toHaveBeenCalled();

      handle.open(); // the connection comes up: the core must load now
      await vi.waitFor(() => expect(handle.requests).toContain('machine.device_power.devices'));
      expect(error).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('loads at once when the connection is already open', async () => {
    const handle = fakeHandle('open');
    const stop = mountSystem(handle, 'open-1');
    try {
      await vi.waitFor(() => expect(handle.requests).toContain('machine.device_power.devices'));
    } finally {
      stop();
    }
  });
});
