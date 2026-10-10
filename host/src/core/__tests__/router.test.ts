import { describe, expect, it } from 'vitest';

import {
  buildHash,
  createRouter,
  parseRoute,
  type Route,
  type RouterEnv,
} from '../router.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { createPrinterManager } from '../printer-manager.svelte.ts';
import { MemoryStorage } from '../storage';

// ------------------------------------------------------------------
// Mock environment
// ------------------------------------------------------------------

function createMockEnv(initialHash = '#/'): RouterEnv & {
  simulateHashChange(newHash: string): void;
} {
  let currentHash = initialHash;
  const listeners = new Set<() => void>();

  return {
    getHash: () => currentHash,

    setHash: (hash: string) => {
      currentHash = hash;
      // Simulate async hashchange event synchronously for tests
      for (const listener of Array.from(listeners)) {
        listener();
      }
    },

    onHashChange: (callback: () => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    simulateHashChange(newHash: string) {
      currentHash = newHash;
      for (const listener of Array.from(listeners)) {
        listener();
      }
    },
  };
}

function setup(initialHash = '#/') {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const printerManager = createPrinterManager(settings, {
    getProxy: () => {
      throw new Error('Not needed for router tests');
    },
  });

  const env = createMockEnv(initialHash);

  const router = createRouter(
    { settings, printerManager },
    { env },
  );

  return { storage, settings, printerManager, router, env };
}

// ------------------------------------------------------------------
// parseRoute
// ------------------------------------------------------------------

describe('router / parseRoute', () => {
  it('parses empty hash as dashboard', () => {
    expect(parseRoute('')).toEqual({ kind: 'dashboard', printerId: null });
    expect(parseRoute('#')).toEqual({ kind: 'dashboard', printerId: null });
    expect(parseRoute('#/')).toEqual({ kind: 'dashboard', printerId: null });
  });

  it('parses settings route', () => {
    expect(parseRoute('#/settings')).toEqual({ kind: 'settings', section: null });
  });

  it('parses settings section route', () => {
    expect(parseRoute('#/settings/pages')).toEqual({ kind: 'settings', section: 'pages' });
  });

  it('builds settings hash', () => {
    expect(buildHash({ kind: 'settings', section: null })).toBe('#/settings');
  });

  it('builds settings section hash', () => {
    expect(buildHash({ kind: 'settings', section: 'dashboard' })).toBe('#/settings/dashboard');
  });

  it('parses printer dashboard route', () => {
    expect(parseRoute('#/p/abc123')).toEqual({
      kind: 'dashboard',
      printerId: 'abc123',
    });
  });

  it('parses plugin page route', () => {
    expect(parseRoute('#/p/abc123/console')).toEqual({
      kind: 'plugin-page',
      printerId: 'abc123',
      pageId: 'console',
    });
  });

  it('decodes URI components', () => {
    expect(parseRoute('#/p/my%20printer/my%20page')).toEqual({
      kind: 'plugin-page',
      printerId: 'my printer',
      pageId: 'my page',
    });
  });

  it('falls back to dashboard for unknown paths', () => {
    expect(parseRoute('#/unknown/path')).toEqual({
      kind: 'dashboard',
      printerId: null,
    });
  });
});

// ------------------------------------------------------------------
// buildHash
// ------------------------------------------------------------------

/* describe('router / buildHash', () => {
  it('builds dashboard hash without printer', () => {
    expect(buildHash({ kind: 'dashboard', printerId: null })).toBe('#/');
  });

  it('builds dashboard hash with printer', () => {
    expect(buildHash({ kind: 'dashboard', printerId: 'abc' })).toBe('#/p/abc');
  });

  it('builds settings hash', () => {
    expect(buildHash({ kind: 'settings', section: null })).toBe('#/settings');
  });

  it('builds plugin page hash', () => {
    expect(
      buildHash({ kind: 'plugin-page', printerId: 'abc', pageId: 'console' }),
    ).toBe('#/p/abc/console');
  });

  it('encodes URI components', () => {
    expect(
      buildHash({
        kind: 'plugin-page',
        printerId: 'my printer',
        pageId: 'my page',
      }),
    ).toBe('#/p/my%20printer/my%20page');
  });

  it('roundtrips with parseRoute', () => {
    const routes: Route[] = [
      { kind: 'dashboard', printerId: null },
      { kind: 'dashboard', printerId: 'abc' },
      { kind: 'settings', section: null },
      { kind: 'plugin-page', printerId: 'abc', pageId: 'console' },
    ];

    for (const route of routes) {
      expect(parseRoute(buildHash(route))).toEqual(route);
    }
  });
}); */

// ------------------------------------------------------------------
// Router integration
// ------------------------------------------------------------------

describe('router / integration', () => {
  it('initializes with current hash', () => {
    const { router } = setup('#/settings');

    expect(router.route).toEqual({ kind: 'settings', section:null });
  });

  it('navigates to settings', () => {
    const { router } = setup();

    router.navigateToSettings();

    expect(router.route).toEqual({ kind: 'settings', section:null });
  });

  it('navigates to printer dashboard and sets active printer', () => {
    const { router, printerManager, settings } = setup();

    const printer = settings.addPrinter({
      name: 'Test',
      url: 'http://test.local',
    });

    router.navigateToPrinter(printer.id);

    expect(router.route).toEqual({
      kind: 'dashboard',
      printerId: printer.id,
    });

    expect(printerManager.activePrinterId).toBe(printer.id);
  });

  it('navigates to plugin page', () => {
    const { router, settings, printerManager } = setup();

    const printer = settings.addPrinter({
      name: 'Test',
      url: 'http://test.local',
    });

    router.navigateToPluginPage(printer.id, 'console');

    expect(router.route).toEqual({
      kind: 'plugin-page',
      printerId: printer.id,
      pageId: 'console',
    });

    expect(printerManager.activePrinterId).toBe(printer.id);
  });

  it('reacts to external hash changes (back/forward)', () => {
    const { router, env } = setup();

    env.simulateHashChange('#/settings');

    expect(router.route).toEqual({ kind: 'settings', section: null });
  });

  it('syncs printer on external hash change', () => {
    const { router, env, settings, printerManager } = setup();

    const printer = settings.addPrinter({
      name: 'Test',
      url: 'http://test.local',
    });

    env.simulateHashChange(`#/p/${printer.id}/console`);

    expect(printerManager.activePrinterId).toBe(printer.id);
    expect(router.route).toEqual({
      kind: 'plugin-page',
      printerId: printer.id,
      pageId: 'console',
    });
  });

  it('handles F5 / deep-link on initialization', () => {
    const storage = new MemoryStorage();
    const settings = createSettingsStore({ storage });

    const printer = settings.addPrinter({
      name: 'Deep',
      url: 'http://deep.local',
    });

    const printerManager = createPrinterManager(settings, {
      getProxy: () => {
        throw new Error('Not needed');
      },
    });

    const env = createMockEnv(`#/p/${printer.id}/console`);

    const router = createRouter({ settings, printerManager }, { env });

    // On init, router should have synced the active printer
    expect(printerManager.activePrinterId).toBe(printer.id);
    expect(router.route).toEqual({
      kind: 'plugin-page',
      printerId: printer.id,
      pageId: 'console',
    });
  });
});