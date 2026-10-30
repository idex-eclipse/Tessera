import { describe, expect, it } from 'vitest';

import type { ConnectionStatus, PrinterInfo } from '../../../../plugin-sdk/src/types';

import type { MoonrakerProxy } from '../moonraker-proxy';
import { createPrinterManager } from '../printer-manager.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { MemoryStorage } from '../storage';

type FakeProxy = MoonrakerProxy & {
  simulateOpen(): void;
  simulateClose(): void;
  simulateAuthRequired(): void;
};

function createFakeProxy(url: string): FakeProxy {
  let readyState: ConnectionStatus = 'connecting';
  let disposed = false;

  const statusListeners = new Set<(status: ConnectionStatus) => void>();

  const handle = {
    get readyState() {
      return readyState;
    },

    onConnectionStatusChange(
      callback: (status: ConnectionStatus) => void,
    ): () => void {
      statusListeners.add(callback);

      return () => {
        statusListeners.delete(callback);
      };
    },

    onReady(callback: () => void): () => void {
      if (readyState === 'open') {
        queueMicrotask(callback);
      }

      return () => {
        // no-op in fake
      };
    },

    request: async () => {
      throw new Error('Not used in printer-manager tests');
    },

    subscribe: () => {
      return () => {
        // no-op
      };
    },

    onNotify: () => {
      return () => {
        // no-op
      };
    },

    poll: () => {
      return () => {
        // no-op
      };
    },

    onAuthRequired(callback: () => void): () => void {
      return () => {
        // no-op
      };
    },

    httpBaseUrl: url,
    authToken: null,
  } as unknown as MoonrakerProxy['handle'];

  const authListeners = new Set<() => void>();
  let authToken: string | null = null;
  let authRequired = false;

  const proxy = {
    get disposed() {
      return disposed;
    },

    printerUrl: url.trim().replace(/\/+$/, ''),
    wsUrl: url,
    httpBaseUrl: url,
    handle,

    dispose(): void {
      disposed = true;
      statusListeners.clear();
      authListeners.clear();
    },

    simulateOpen(): void {
      if (disposed) {
        return;
      }

      readyState = 'open';

      for (const listener of Array.from(statusListeners)) {
        listener('open');
      }
    },

    simulateClose(): void {
      if (disposed) {
        return;
      }

      readyState = 'closed';

      for (const listener of Array.from(statusListeners)) {
        listener('closed');
      }
    },

    setAuthToken(token: string | null): void {
      authToken = token;
    },

    onAuthRequired(callback: () => void): () => void {
      authListeners.add(callback);
      return () => {
        authListeners.delete(callback);
      };
    },

    get authRequired() {
      return authRequired;
    },

    /** Test-only: симулировать 401, чтобы auth-store поднял AuthOverlay. */
    simulateAuthRequired(): void {
      authRequired = true;
      for (const listener of Array.from(authListeners)) {
        listener();
      }
    },
  } as FakeProxy;

  return proxy;
}

function createProxyFactory() {
  const proxies: FakeProxy[] = [];
  const pool = new Map<string, FakeProxy>();

  let callCount = 0;

  const factory = (url: string): MoonrakerProxy => {
    const key = url.trim().replace(/\/+$/, '');

    const existing = pool.get(key);

    if (existing && !existing.disposed) {
      return existing;
    }

    callCount += 1;

    const proxy = createFakeProxy(key);

    pool.set(key, proxy);
    proxies.push(proxy);

    return proxy;
  };

  return {
    proxies,
    factory,
    calls: () => callCount,
  };
}

function setup() {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });

  const { proxies, factory, calls } = createProxyFactory();

  let currentTime = 1_000;

  const manager = createPrinterManager(settings, {
    getProxy: factory,
    now: () => currentTime,
  });

  return {
    storage,
    settings,
    manager,
    proxies,
    calls,
    setTime(time: number) {
      currentTime = time;
    },
  };
}

describe('printer-manager / initialization', () => {
  it('attaches proxies for printers already present in settings', () => {
    const storage = new MemoryStorage();

    storage.setItem(
      'mpu:v2:printers',
      JSON.stringify([
        {
          id: 'p1',
          name: 'Printer 1',
          url: 'http://p1.local',
        },
        {
          id: 'p2',
          name: 'Printer 2',
          url: 'http://p2.local',
        },
      ]),
    );

    storage.setItem('mpu:v2:activePrinter', 'p1');

    const settings = createSettingsStore({ storage });
    const { proxies, factory, calls } = createProxyFactory();

    const manager = createPrinterManager(settings, {
      getProxy: factory,
    });

    expect(calls()).toBe(2);
    expect(proxies).toHaveLength(2);

    expect(manager.getConnection('p1')?.status).toBe('connecting');
    expect(manager.getConnection('p2')?.status).toBe('connecting');

    manager.dispose();
  });
});

describe('printer-manager / CRUD and active printer', () => {
  it('adds printer, attaches proxy and notifies active printer change', () => {
    const { manager } = setup();

    let notified: unknown = undefined;

    manager.onPrinterChange((printer) => {
      notified = printer;
    });

    const printer = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    expect(manager.printers).toHaveLength(1);
    expect(manager.activePrinterId).toBe(printer.id);

    expect(manager.getConnection(printer.id)?.status).toBe('connecting');

    expect(notified).toEqual({
      id: printer.id,
      name: 'A',
      url: 'http://a.local',
    });

    manager.dispose();
  });

  it('updates printer URL and reattaches proxy', () => {
    const { manager, proxies, calls } = setup();

    const printer = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const oldProxy = proxies[0] as FakeProxy;

    manager.updatePrinter(printer.id, {
      url: 'http://b.local/',
    });

    expect(oldProxy.disposed).toBe(true);
    expect(calls()).toBe(2);

    expect(manager.getConnection(printer.id)?.url).toBe('http://b.local');
    expect(manager.getConnection(printer.id)?.status).toBe('connecting');

    manager.dispose();
  });

  it('removes printer, disposes proxy and switches active printer', () => {
    const { manager, proxies } = setup();

    const first = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const second = manager.addPrinter({
      name: 'B',
      url: 'http://b.local',
    });

    manager.setActivePrinter(second.id);
    manager.removePrinter(second.id);

    expect(manager.activePrinterId).toBe(first.id);
    expect(manager.getConnection(second.id)).toBeNull();

    expect((proxies[1] as FakeProxy).disposed).toBe(true);
    expect((proxies[0] as FakeProxy).disposed).toBe(false);

    manager.dispose();
  });

  it('does not dispose old proxy when switching active printer', () => {
    const { manager, proxies } = setup();

    const first = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const second = manager.addPrinter({
      name: 'B',
      url: 'http://b.local',
    });

    let notified: unknown = undefined;

    manager.onPrinterChange((printer) => {
      notified = printer;
    });

    manager.setActivePrinter(second.id);

    expect(manager.activePrinterId).toBe(second.id);
    expect(manager.activeConnection?.printerId).toBe(second.id);

    expect(notified).toEqual({
      id: second.id,
      name: 'B',
      url: 'http://b.local',
    });

    expect((proxies[0] as FakeProxy).disposed).toBe(false);
    expect((proxies[1] as FakeProxy).disposed).toBe(false);

    expect(first.id).not.toBe(second.id);

    manager.dispose();
  });
});

describe('printer-manager / connection state', () => {
  it('updates connection state and lastSuccessfulAt', () => {
    const { manager, proxies, setTime } = setup();

    const printer = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const proxy = proxies[0] as FakeProxy;

    expect(manager.getConnection(printer.id)?.status).toBe('connecting');
    expect(manager.getConnection(printer.id)?.lastSuccessfulAt).toBeNull();

    proxy.simulateOpen();

    expect(manager.getConnection(printer.id)?.status).toBe('open');
    expect(manager.getConnection(printer.id)?.lastSuccessfulAt).toBe(1_000);

    setTime(2_000);
    proxy.simulateClose();

    expect(manager.getConnection(printer.id)?.status).toBe('closed');
    expect(manager.getConnection(printer.id)?.lastSuccessfulAt).toBe(1_000);

    setTime(3_000);
    proxy.simulateOpen();

    expect(manager.getConnection(printer.id)?.status).toBe('open');
    expect(manager.getConnection(printer.id)?.lastSuccessfulAt).toBe(3_000);

    manager.dispose();
  });

  it('shows offline overlay while active printer is connecting or closed, hides it when open', () => {
    const { manager, proxies } = setup();

    const printer = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const proxy = proxies[0] as FakeProxy;

    // connecting: overlay stays visible (no flicker between reconnect attempts),
    // but the printer is not considered offline yet
    expect(manager.activeConnection?.status).toBe('connecting');
    expect(manager.shouldShowOfflineOverlay).toBe(true);
    expect(manager.isActivePrinterOffline).toBe(false);

    proxy.simulateClose();

    expect(manager.shouldShowOfflineOverlay).toBe(true);
    expect(manager.isActivePrinterOffline).toBe(true);

    proxy.simulateOpen();

    expect(manager.shouldShowOfflineOverlay).toBe(false);
    expect(manager.isActivePrinterOffline).toBe(false);

    expect(printer.id).toBe(manager.activePrinterId);

    manager.dispose();
  });
});

describe('printer-manager / shared URL refcounting', () => {
  it('shares one proxy for duplicate URLs and disposes only when last reference is removed', () => {
    const { manager, proxies, calls } = setup();

    const first = manager.addPrinter({
      name: 'A',
      url: 'http://same.local',
    });

    const second = manager.addPrinter({
      name: 'B',
      url: 'http://same.local',
    });

    expect(calls()).toBe(1);

    const proxy = proxies[0] as FakeProxy;

    proxy.simulateOpen();

    expect(manager.getConnection(first.id)?.status).toBe('open');
    expect(manager.getConnection(second.id)?.status).toBe('open');

    manager.removePrinter(first.id);

    expect(proxy.disposed).toBe(false);
    expect(manager.getConnection(second.id)?.status).toBe('open');

    manager.removePrinter(second.id);

    expect(proxy.disposed).toBe(true);

    manager.dispose();
  });
});

describe('printer-manager / retry', () => {
  it('retries active printer by recreating proxy', () => {
    const { manager, proxies, calls } = setup();

    const printer = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const oldProxy = proxies[0] as FakeProxy;

    oldProxy.simulateOpen();

    expect(manager.getConnection(printer.id)?.status).toBe('open');

    manager.retry(printer.id);

    expect(oldProxy.disposed).toBe(true);
    expect(calls()).toBe(2);

    expect(manager.getConnection(printer.id)?.status).toBe('connecting');

    manager.dispose();
  });

  it('recreates shared proxy for all printer records using same URL', () => {
    const { manager, proxies, calls } = setup();

    const first = manager.addPrinter({
      name: 'A',
      url: 'http://same.local',
    });

    const second = manager.addPrinter({
      name: 'B',
      url: 'http://same.local',
    });

    const oldProxy = proxies[0] as FakeProxy;

    oldProxy.simulateOpen();

    manager.retry(first.id);

    expect(oldProxy.disposed).toBe(true);
    expect(calls()).toBe(2);

    expect(manager.getConnection(first.id)?.status).toBe('connecting');
    expect(manager.getConnection(second.id)?.status).toBe('connecting');

    const newProxy = proxies[1] as FakeProxy;

    newProxy.simulateOpen();

    expect(manager.getConnection(first.id)?.status).toBe('open');
    expect(manager.getConnection(second.id)?.status).toBe('open');

    manager.dispose();
  });
});

describe('printer-manager / syncFromSettings', () => {
  it('attaches printers added directly through settings store', () => {
    const { settings, manager, calls } = setup();

    settings.addPrinter({
      name: 'Direct',
      url: 'http://direct.local',
    });

    expect(calls()).toBe(0);

    manager.syncFromSettings();

    expect(calls()).toBe(1);
    expect(manager.printers).toHaveLength(1);

    const printer = manager.printers[0];

    expect(manager.getConnection(printer!.id)?.status).toBe('connecting');

    manager.dispose();
  });

  it('detaches printers removed directly through settings store', () => {
    const { settings, manager, proxies } = setup();

    const printer = manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const proxy = proxies[0] as FakeProxy;

    /**
     * Emulate external removal by directly mutating settings.
     * In real UI printer-manager CRUD should be preferred.
     */
    settings.removePrinter(printer.id);

    expect(proxy.disposed).toBe(false);

    manager.syncFromSettings();

    expect(proxy.disposed).toBe(true);
    expect(manager.getConnection(printer.id)).toBeNull();

    manager.dispose();
  });
});

describe('printer-manager / printers list change subscription', () => {
  it('notifies listeners on add, update and remove', () => {
    const { manager } = setup();
    const seen: PrinterInfo[][] = [];

    manager.onPrintersChange((list) => seen.push(list));

    const a = manager.addPrinter({ name: 'A', url: 'http://a.local' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([{ id: a.id, name: 'A', url: 'http://a.local' }]);

    manager.updatePrinter(a.id, { name: 'A2' });
    expect(seen).toHaveLength(2);
    expect(seen[1]![0]!.name).toBe('A2');

    const b = manager.addPrinter({ name: 'B', url: 'http://b.local' });
    expect(seen).toHaveLength(3);

    manager.removePrinter(a.id);
    expect(seen).toHaveLength(4);
    expect(seen[3]).toEqual([{ id: b.id, name: 'B', url: 'http://b.local' }]);

    manager.dispose();
  });

  it('notifies on syncFromSettings after external settings mutation', () => {
    const { settings, manager } = setup();
    const seen: PrinterInfo[][] = [];

    manager.onPrintersChange((list) => seen.push(list));

    settings.addPrinter({ name: 'Direct', url: 'http://direct.local' });
    expect(seen).toHaveLength(0); // sync ещё не вызывали

    manager.syncFromSettings();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]![0]!.name).toBe('Direct');

    manager.dispose();
  });

  it('does not notify on setActivePrinter or retry (список не меняется)', () => {
    const { manager, proxies } = setup();

    const a = manager.addPrinter({ name: 'A', url: 'http://a.local' });
    const b = manager.addPrinter({ name: 'B', url: 'http://b.local' });

    const seen: PrinterInfo[][] = [];
    manager.onPrintersChange((list) => seen.push(list));

    manager.setActivePrinter(b.id);
    (proxies[0] as FakeProxy).simulateOpen();
    manager.retry(a.id);

    expect(seen).toHaveLength(0);

    manager.dispose();
  });

  it('stops notifying after unsubscribe and after dispose', () => {
    const { manager } = setup();
    const seen: PrinterInfo[][] = [];

    const off = manager.onPrintersChange((list) => seen.push(list));

    manager.addPrinter({ name: 'A', url: 'http://a.local' });
    expect(seen).toHaveLength(1);

    off();
    manager.addPrinter({ name: 'B', url: 'http://b.local' });
    expect(seen).toHaveLength(1);

    const seen2: PrinterInfo[][] = [];
    manager.onPrintersChange((list) => seen2.push(list));
    manager.dispose();
    manager.addPrinter({ name: 'C', url: 'http://c.local' }); // dispose очистил слушателей
    expect(seen2).toHaveLength(0);
  });
});

describe('printer-manager / dispose', () => {
  it('disposes all owned proxies and clears connection states', () => {
    const { manager, proxies } = setup();

    manager.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    manager.addPrinter({
      name: 'B',
      url: 'http://b.local',
    });

    const firstProxy = proxies[0] as FakeProxy;
    const secondProxy = proxies[1] as FakeProxy;

    manager.dispose();

    expect(firstProxy.disposed).toBe(true);
    expect(secondProxy.disposed).toBe(true);
    expect(manager.connections).toEqual({});
  });
});