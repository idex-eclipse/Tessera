import { describe, expect, it } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { acquireKlippyState } from '../klippy-state/use-klippy-state.svelte';

/**
 * A minimal Moonraker handle that counts live subscriptions, so a test can tell whether a
 * klippy-state core was torn down (evicted by the keeper) or is still held.
 */
function fakeApi() {
  let live = 0;
  const track = () => {
    live++;
    let off = false;
    return () => {
      if (off) return;
      off = true;
      live--;
    };
  };
  const handle = {
    readyState: 'closed',
    poll: () => track(),
    subscribe: () => track(),
    onNotify: () => track(),
    onConnectionStatusChange: () => track(),
    onReady: () => track(),
    request: async () => ({}),
  };
  const api = {
    printer: { id: 'k0' },
    moonrakerFor: () => handle,
    onPrintersChange: () => () => {},
  } as unknown as PluginApi;
  return { api, live: () => live };
}

describe('acquireKlippyState', () => {
  it('works outside a component (no Svelte lifecycle involved)', () => {
    // Regression: use-system / use-health created their klippy hold through useKlippyState,
    // whose onDestroy throws `lifecycle_outside_component` when a core is built by the keeper
    // from a printer-change listener.
    const { api } = fakeApi();
    const hold = acquireKlippyState(api, 'h1');
    expect(hold.store.state).toBe('unknown');
    hold.release();
  });

  it('release is idempotent', () => {
    const { api } = fakeApi();
    const hold = acquireKlippyState(api, 'h2');
    hold.release();
    expect(() => hold.release()).not.toThrow();
  });

  it('a released hold makes the core evictable', () => {
    // The keeper keeps at most 4 cores warm and evicts only idle (refs = 0) ones, so a core that
    // never released its hold (the old use-system / use-health behaviour) would leak its
    // subscriptions forever. Here five cores are held (cap exceeded temporarily, nothing evicted)...
    const { api, live } = fakeApi();
    const holds = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => acquireKlippyState(api, id));
    const subsPerCore = live() / 5;
    expect(subsPerCore).toBeGreaterThan(0);

    // ...and as soon as they are released the surplus idle core is destroyed.
    for (const h of holds) h.release();
    expect(live()).toBe(subsPerCore * 4);
  });
});
