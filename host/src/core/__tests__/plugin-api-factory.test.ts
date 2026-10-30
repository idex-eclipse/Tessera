import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionStatus, PrinterInfo } from '../../../../plugin-sdk/src/types';
import type { AppContext } from '../../app-context';

import { createFleetIndex } from '../fleet-index.svelte.ts';
import { createPluginApi } from '../plugin-api-factory';

// ------------------------------------------------------------------
// Mock пула прокси: фабрика резолвит handle по url из общего реестра,
// чтобы тесты могли инспектировать вызовы конкретного принтера.
// ------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const handles = new Map<string, Record<string, any>>();
  return { handles };
});

vi.mock('../moonraker-proxy', () => {
  function createHandle(url: string) {
    return {
      request: vi.fn(async (method: string, params?: unknown) => ({
        ok: true,
        method,
        params,
        url,
      })),
      subscribe: vi.fn(() => () => {}),
      onNotify: vi.fn(() => () => {}),
      poll: vi.fn(() => () => {}),
      httpBaseUrl: url,
      readyState: 'open' as ConnectionStatus,
      authToken: null,
      onReady: vi.fn(() => () => {}),
      onConnectionStatusChange: vi.fn(() => () => {}),
    };
  }

  return {
    getMoonrakerProxy: (url: string) => {
      const key = url.trim().replace(/\/+$/, '');
      let handle = mocks.handles.get(key);
      if (!handle) {
        handle = createHandle(key);
        mocks.handles.set(key, handle);
      }
      return { handle, printerUrl: key, disposed: false, dispose: () => {} };
    },
  };
});

function handleOf(url: string): Record<string, any> | undefined {
  return mocks.handles.get(url.trim().replace(/\/+$/, ''));
}

// ------------------------------------------------------------------
// Фейковый printer-manager (контракт, который читает фабрика)
// ------------------------------------------------------------------

interface FakePrinter {
  id: string;
  name: string;
  url: string;
}

function createFakeManager() {
  let printers: FakePrinter[] = [];
  let activePrinterId: string | null = null;

  const activeListeners = new Set<(p: PrinterInfo | null) => void>();
  const listListeners = new Set<(p: PrinterInfo[]) => void>();

  const toInfo = (p: FakePrinter): PrinterInfo => ({
    id: p.id,
    name: p.name,
    url: p.url,
  });

  return {
    get printers() {
      return printers;
    },
    get activePrinterId() {
      return activePrinterId;
    },
    get activePrinter() {
      return printers.find((p) => p.id === activePrinterId) ?? null;
    },

    setActivePrinter(id: string | null): void {
      activePrinterId = id;
      const info = this.activePrinter ? toInfo(this.activePrinter) : null;
      for (const cb of Array.from(activeListeners)) cb(info);
    },

    onPrinterChange(cb: (p: PrinterInfo | null) => void): () => void {
      activeListeners.add(cb);
      return () => {
        activeListeners.delete(cb);
      };
    },

    onPrintersChange(cb: (p: PrinterInfo[]) => void): () => void {
      listListeners.add(cb);
      return () => {
        listListeners.delete(cb);
      };
    },

    // test-хелперы мутаций
    add(id: string, name: string, url: string): void {
      printers = [...printers, { id, name, url }];
      this.notifyList();
    },
    move(id: string, url: string): void {
      printers = printers.map((p) => (p.id === id ? { ...p, url } : p));
      this.notifyList();
    },
    remove(id: string): void {
      printers = printers.filter((p) => p.id !== id);
      if (activePrinterId === id) activePrinterId = null;
      this.notifyList();
    },
    notifyList(): void {
      for (const cb of Array.from(listListeners)) cb(printers.map(toInfo));
    },
  };
}

type FakeManager = ReturnType<typeof createFakeManager>;

function createCtx(manager: FakeManager, fleetIndex = createFleetIndex()): AppContext {
  return {
    printerManager: manager,
    fleetIndex,
    settings: {
      getPluginSetting: () => undefined,
      setPluginSetting: () => {},
      getPluginSettings: () => ({}),
      onPluginSettingsChange: () => () => {},
    },
    i18n: {
      t: (key: string) => key,
      locale: 'en',
      onLocaleChange: () => () => {},
    },
    ui: {
      theme: 'light',
      onThemeChange: () => () => {},
    },
  } as unknown as AppContext;
}

const MANIFEST = {
  id: 'test-plugin',
  name: 'Test plugin',
  version: '1.0.0',
  entry: 'entry.js',
} as const;

function setupWithPrinters() {
  const manager = createFakeManager();
  manager.add('a', 'Printer A', 'http://a.local');
  manager.add('b', 'Printer B', 'http://b.local');
  manager.setActivePrinter('a');
  // setActivePrinter триггерит notifyActivePrinterChange, но не list — сбрасываем шум
  const api = createPluginApi(createCtx(manager), MANIFEST.id, { ...MANIFEST });
  return { manager, api };
}

beforeEach(() => {
  mocks.handles.clear();
});

// ------------------------------------------------------------------

describe('plugin-api-factory / active printer sugar', () => {
  it('moonraker() throws when there is no active printer', () => {
    const manager = createFakeManager();
    const api = createPluginApi(createCtx(manager), MANIFEST.id, { ...MANIFEST });

    expect(() => api.moonraker()).toThrow(/No active printer/);
  });

  it('moonraker().request routes to the active printer proxy', async () => {
    const { api } = setupWithPrinters();

    const result = await api.moonraker().request('printer.info');

    expect(result).toMatchObject({ ok: true, method: 'printer.info', url: 'http://a.local' });
    expect(handleOf('http://a.local')!.request).toHaveBeenCalledWith('printer.info', undefined);
    expect(handleOf('http://b.local')).toBeUndefined();
  });

  it('moonraker() handle follows active printer switch (lazy resolve)', async () => {
    const { manager, api } = setupWithPrinters();

    const handle = api.moonraker();
    manager.setActivePrinter('b');

    const result = await handle.request('server.info');

    expect(result).toMatchObject({ url: 'http://b.local' });
    expect(handleOf('http://b.local')!.request).toHaveBeenCalled();
  });

  it('printer getter reflects active printer; empty object without printers', () => {
    const manager = createFakeManager();
    const api = createPluginApi(createCtx(manager), MANIFEST.id, { ...MANIFEST });
    expect(api.printer).toEqual({ id: '', name: '', url: '' });

    manager.add('a', 'Printer A', 'http://a.local');
    manager.setActivePrinter('a');
    expect(api.printer).toEqual({ id: 'a', name: 'Printer A', url: 'http://a.local' });
  });
});

describe('plugin-api-factory / multi-printer API', () => {
  it('printers getter maps the live roster', () => {
    const { manager, api } = setupWithPrinters();

    expect(api.printers).toEqual([
      { id: 'a', name: 'Printer A', url: 'http://a.local' },
      { id: 'b', name: 'Printer B', url: 'http://b.local' },
    ]);

    manager.add('c', 'Printer C', 'http://c.local');
    expect(api.printers).toHaveLength(3);
  });

  it('moonrakerFor throws on unknown printerId', () => {
    const { api } = setupWithPrinters();
    expect(() => api.moonrakerFor('nope')).toThrow(/unknown printerId/);
  });

  it('moonrakerFor returns a stable cached handle', () => {
    const { api } = setupWithPrinters();
    expect(api.moonrakerFor('b')).toBe(api.moonrakerFor('b'));
  });

  it('moonrakerFor routes to the target printer regardless of active', async () => {
    const { api } = setupWithPrinters(); // active = a

    const result = await api.moonrakerFor('b').request('server.info');

    expect(result).toMatchObject({ url: 'http://b.local' });
    expect(handleOf('http://b.local')!.request).toHaveBeenCalledWith('server.info', undefined);
    expect(handleOf('http://a.local')).toBeUndefined();
  });

  it('moonrakerFor handle follows printer url change', async () => {
    const { manager, api } = setupWithPrinters();

    const handle = api.moonrakerFor('b');
    manager.move('b', 'http://b2.local');

    const result = await handle.request('server.info');

    expect(result).toMatchObject({ url: 'http://b2.local' });
    expect(handleOf('http://b2.local')!.request).toHaveBeenCalled();
  });

  it('moonrakerFor handle degrades safely after printer removal', async () => {
    const { manager, api } = setupWithPrinters();

    const handle = api.moonrakerFor('b');

    // Форсируем создание handle через реальный request — ленивый live()
    // должен создать handle в mock-реестре до удаления принтера.
    await handle.request('printer.info');
    const bHandle = handleOf('http://b.local')!;

    manager.remove('b');

    expect(handle.readyState).toBe('closed');
    expect(handle.httpBaseUrl).toBe('');
    expect(handle.authToken).toBeNull();

    await expect(handle.request('printer.info')).rejects.toThrow(/not configured/);

    const subsBefore = bHandle.subscribe.mock.calls.length;
    const unsub = handle.subscribe({ toolhead: ['position'] }, () => {});
    expect(typeof unsub).toBe('function');
    unsub();
    expect(bHandle.subscribe.mock.calls.length).toBe(subsBefore);

    const status = await new Promise<ConnectionStatus>((resolve) => {
      handle.onConnectionStatusChange(resolve);
    });
    expect(status).toBe('closed');
  });

  it('setActivePrinter delegates to printer manager', () => {
    const { manager, api } = setupWithPrinters();

    api.setActivePrinter('b');
    expect(manager.activePrinterId).toBe('b');

    api.setActivePrinter(null);
    expect(manager.activePrinterId).toBeNull();
  });

  it('onPrintersChange delegates manager notifications', () => {
    const { manager, api } = setupWithPrinters();

    const seen: PrinterInfo[][] = [];
    const off = api.onPrintersChange((list) => seen.push(list));

    manager.add('c', 'Printer C', 'http://c.local');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(3);

    off();
    manager.remove('c');
    expect(seen).toHaveLength(1);
  });

  it('onPrinterChange still fires only for non-null active printer', () => {
    const { manager, api } = setupWithPrinters();

    const seen: PrinterInfo[] = [];
    api.onPrinterChange((p) => seen.push(p));

    manager.setActivePrinter('b');
    manager.setActivePrinter(null); // фабрика фильтрует null
    manager.setActivePrinter('a');

    expect(seen).toEqual([
      { id: 'b', name: 'Printer B', url: 'http://b.local' },
      { id: 'a', name: 'Printer A', url: 'http://a.local' },
    ]);
  });
});
describe('plugin-api-factory / fleet index', () => {
  const entry = {
    tags: [{ id: 'printing', labelKey: 'k.printing' }],
    searchText: 'benchy.gcode',
  };

  function setupFleet() {
    const manager = createFakeManager();
    manager.add('a', 'Printer A', 'http://a.local');
    const fleetIndex = createFleetIndex();
    const ctx = createCtx(manager, fleetIndex);
    return { manager, fleetIndex, ctx };
  }

  it('fleet.publish stores the record under the calling plugin id', () => {
    const { ctx, fleetIndex } = setupFleet();
    const api = createPluginApi(ctx, 'plugin-one', { ...MANIFEST, id: 'plugin-one' });

    api.fleet.publish('a', entry);

    expect(fleetIndex.forPrinter('a')).toEqual(entry);
  });

  it('records of different plugins do not overwrite each other; retract is per plugin', () => {
    const { ctx, fleetIndex } = setupFleet();
    const one = createPluginApi(ctx, 'plugin-one', { ...MANIFEST, id: 'plugin-one' });
    const two = createPluginApi(ctx, 'plugin-two', { ...MANIFEST, id: 'plugin-two' });

    one.fleet.publish('a', entry);
    two.fleet.publish('a', { tags: [], searchText: 'other' });
    expect(fleetIndex.forPrinter('a')!.searchText).toBe('benchy.gcode\nother');

    one.fleet.retract('a');
    expect(fleetIndex.forPrinter('a')).toEqual({ tags: [], searchText: 'other' });
  });

  it('fleet.publish ignores an unknown printerId (printer removed meanwhile)', () => {
    const { ctx, fleetIndex } = setupFleet();
    const api = createPluginApi(ctx, 'plugin-one', { ...MANIFEST, id: 'plugin-one' });

    expect(() => api.fleet.publish('gone', entry)).not.toThrow();
    expect(fleetIndex.forPrinter('gone')).toBeNull();
  });
});
