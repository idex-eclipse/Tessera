import { describe, expect, it } from 'vitest';

import { MemoryStorage } from '../storage';

import {
  createSettingsStore,
  pluginSettingsStorageKey,
  printerSettingsStorageKey,
  SETTINGS_STORAGE_KEYS,
} from '../settings-store.svelte.ts';

function setup() {
  const storage = new MemoryStorage();
  const store = createSettingsStore({ storage });

  return { storage, store };
}

function parseStored<T>(storage: MemoryStorage, key: string): T | null {
  const raw = storage.getItem(key);

  if (raw === null) {
    return null;
  }

  return JSON.parse(raw) as T;
}

describe('settings-store / base state', () => {
  it('returns defaults for empty storage', () => {
    const { store } = setup();

    expect(store.printers).toEqual([]);
    expect(store.activePrinterId).toBeNull();
    expect(store.activePrinter).toBeNull();
    expect(store.plugins).toEqual([]);
    expect(store.legacy.detected).toBe(false);

    expect(store.ui).toEqual({
      theme: 'light',
      locale: 'en',
      dir: 'ltr',
      sidebarCollapsed: false,
      sidebarWidth: 280,
    });
  });

  it('falls back to defaults on corrupted storage', () => {
    const storage = new MemoryStorage();

    storage.setItem(SETTINGS_STORAGE_KEYS.printers, '{broken');
    storage.setItem(SETTINGS_STORAGE_KEYS.ui, '[1,2,3]');

    const store = createSettingsStore({ storage });

    expect(store.printers).toEqual([]);
    expect(store.ui.theme).toBe('light');
    expect(store.ui.locale).toBe('en');
  });
});

describe('settings-store / printers', () => {
  it('adds printer, persists it and selects first active printer', () => {
    const { storage, store } = setup();

    const printer = store.addPrinter({
      name: 'Orange Pi',
      url: 'http://orangepi.local/',
    });

    expect(store.printers).toHaveLength(1);
    expect(store.activePrinterId).toBe(printer.id);
    expect(store.activePrinter?.id).toBe(printer.id);

    expect(printer.url).toBe('http://orangepi.local');

    const storedPrinters = parseStored<unknown[]>(
      storage,
      SETTINGS_STORAGE_KEYS.printers,
    );

    expect(storedPrinters).toEqual([printer]);

    expect(storage.getItem(SETTINGS_STORAGE_KEYS.activePrinter)).toBe(
      printer.id,
    );
  });

  it('does not change active printer when adding another printer', () => {
    const { store } = setup();

    const first = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    store.addPrinter({
      name: 'B',
      url: 'http://b.local',
    });

    expect(store.activePrinterId).toBe(first.id);
  });

  it('updates printer and persists changes', () => {
    const { storage, store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    store.updatePrinter(printer.id, {
      name: 'Updated',
      url: 'http://updated.local/',
    });

    expect(store.printers[0]?.name).toBe('Updated');
    expect(store.printers[0]?.url).toBe('http://updated.local');

    const storedPrinters = parseStored<Array<Record<string, unknown>>>(
      storage,
      SETTINGS_STORAGE_KEYS.printers,
    );

    expect(storedPrinters?.[0]).toMatchObject({
      id: printer.id,
      name: 'Updated',
      url: 'http://updated.local',
    });
  });

  it('normalizes invalid stored active printer id', () => {
    const storage = new MemoryStorage();

    storage.setItem(
      SETTINGS_STORAGE_KEYS.printers,
      JSON.stringify([
        {
          id: 'p1',
          name: 'Printer',
          url: 'http://printer.local',
        },
      ]),
    );

    storage.setItem(SETTINGS_STORAGE_KEYS.activePrinter, 'wrong-id');

    const store = createSettingsStore({ storage });

    expect(store.activePrinterId).toBe('p1');
    expect(storage.getItem(SETTINGS_STORAGE_KEYS.activePrinter)).toBe('p1');
  });

  it('removes printer and selects next active printer', () => {
    const { storage, store } = setup();

    const first = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const second = store.addPrinter({
      name: 'B',
      url: 'http://b.local',
    });

    store.setActivePrinter(second.id);
    store.removePrinter(second.id);

    expect(store.printers).toHaveLength(1);
    expect(store.activePrinterId).toBe(first.id);

    expect(storage.getItem(SETTINGS_STORAGE_KEYS.activePrinter)).toBe(
      first.id,
    );
  });

  it('removes printer settings and plugin settings when printer is removed', () => {
    const { storage, store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    store.setPageVisibility(printer.id, 'console', false);
    store.setPluginSetting(printer.id, 'dummy-plugin', 'foo', 42);

    const printerSettingsKey = printerSettingsStorageKey(printer.id);
    const pluginSettingsKey = pluginSettingsStorageKey(
      printer.id,
      'dummy-plugin',
    );

    expect(storage.getItem(printerSettingsKey)).not.toBeNull();
    expect(storage.getItem(pluginSettingsKey)).not.toBeNull();

    store.removePrinter(printer.id);

    expect(storage.getItem(printerSettingsKey)).toBeNull();
    expect(storage.getItem(pluginSettingsKey)).toBeNull();
  });
});

describe('settings-store / remote plugins', () => {
  it('adds, disables and removes remote plugins', () => {
    const { storage, store } = setup();

    const manifestUrl = 'http://plugin.local/manifest.json';

    store.addPlugin(manifestUrl);

    expect(store.plugins).toHaveLength(1);
    expect(store.plugins[0]?.enabled).toBe(true);

    store.addPlugin(manifestUrl);

    expect(store.plugins).toHaveLength(1);

    store.setPluginEnabled(manifestUrl, false);

    expect(store.plugins[0]?.enabled).toBe(false);

    const storedPlugins = parseStored<Array<Record<string, unknown>>>(
      storage,
      SETTINGS_STORAGE_KEYS.plugins,
    );

    expect(storedPlugins?.[0]).toMatchObject({
      manifestUrl,
      enabled: false,
    });

    store.removePlugin(manifestUrl);

    expect(store.plugins).toHaveLength(0);

    const storedAfterRemove = parseStored<unknown[]>(
      storage,
      SETTINGS_STORAGE_KEYS.plugins,
    );

    expect(storedAfterRemove).toEqual([]);
  });
});

describe('settings-store / ui state', () => {
  it('patches ui state and persists it', () => {
    const { storage, store } = setup();

    store.setTheme('dark');
    store.setLocale('ru', 'ltr');
    store.setSidebarWidth(320);
    store.toggleSidebar(true);

    expect(store.ui.theme).toBe('dark');
    expect(store.ui.locale).toBe('ru');
    expect(store.ui.dir).toBe('ltr');
    expect(store.ui.sidebarWidth).toBe(320);
    expect(store.ui.sidebarCollapsed).toBe(true);

    const storedUi = parseStored<Record<string, unknown>>(
      storage,
      SETTINGS_STORAGE_KEYS.ui,
    );

    expect(storedUi).toMatchObject({
      theme: 'dark',
      locale: 'ru',
      dir: 'ltr',
      sidebarWidth: 320,
      sidebarCollapsed: true,
    });
  });
});

describe('settings-store / per-printer settings', () => {
  it('uses visible-by-default for pages and persists explicit visibility', () => {
    const { storage, store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    expect(store.getPageVisibility(printer.id, 'console')).toBe(true);

    store.setPageVisibility(printer.id, 'console', false);

    expect(store.getPageVisibility(printer.id, 'console')).toBe(false);

    const stored = parseStored<Record<string, unknown>>(
      storage,
      printerSettingsStorageKey(printer.id),
    );

    expect(stored).toMatchObject({
      pages: {
        console: false,
      },
    });
  });

  it('stores and clears explicit widget provider selection', () => {
    const { storage, store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    store.setWidgetProvider(printer.id, 'temperature-graph', '@core/widgets');

    expect(
      store.getWidgetProvider(printer.id, 'temperature-graph'),
    ).toBe('@core/widgets');

    const storedBeforeClear = parseStored<Record<string, unknown>>(
      storage,
      printerSettingsStorageKey(printer.id),
    );

    expect(storedBeforeClear).toMatchObject({
      widgetProviders: {
        'temperature-graph': '@core/widgets',
      },
    });

    store.clearWidgetProvider(printer.id, 'temperature-graph');

    expect(
      store.getWidgetProvider(printer.id, 'temperature-graph'),
    ).toBeUndefined();

    const storedAfterClear = parseStored<Record<string, unknown>>(
      storage,
      printerSettingsStorageKey(printer.id),
    );

    expect(storedAfterClear).toMatchObject({
      widgetProviders: {},
    });
  });

  it('stores dashboard layout and resets it', () => {
    const { storage, store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const layout = [
      {
        instanceId: 'widget-1',
        type: 'temperature-graph',
        provider: '@core/widgets',
        x: 0,
        y: 0,
        w: 4,
        h: 3,
      },
    ];

    store.setDashboardLayout(printer.id, layout);

    expect(store.getDashboardLayout(printer.id)).toEqual(layout);

    const stored = parseStored<Record<string, unknown>>(
      storage,
      printerSettingsStorageKey(printer.id),
    );

    expect(stored).toMatchObject({
      dashboardLayout: layout,
    });

    store.resetDashboardLayout(printer.id);

    expect(store.getDashboardLayout(printer.id)).toEqual([]);
  });
});

describe('settings-store / plugin settings', () => {
  it('reads and writes plugin settings', () => {
    const { storage, store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    store.setPluginSetting(printer.id, 'dummy-plugin', 'foo', 42);

    expect(store.getPluginSetting(printer.id, 'dummy-plugin', 'foo')).toBe(42);

    const stored = parseStored<Record<string, unknown>>(
      storage,
      pluginSettingsStorageKey(printer.id, 'dummy-plugin'),
    );

    expect(stored).toMatchObject({
      foo: 42,
    });
  });

  it('notifies plugin settings listeners and supports unsubscribe', () => {
    const { store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    let last: Record<string, unknown> | null = null;

    const unsubscribe = store.onPluginSettingsChange(
      printer.id,
      'dummy-plugin',
      (settings) => {
        last = settings;
      },
    );

    store.setPluginSetting(printer.id, 'dummy-plugin', 'foo', 1);

    expect(last).toEqual({ foo: 1 });

    unsubscribe();

    store.setPluginSetting(printer.id, 'dummy-plugin', 'foo', 2);

    expect(last).toEqual({ foo: 1 });
  });

  it('applies plugin defaults only for missing keys', () => {
    const { store } = setup();

    const printer = store.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    store.applyPluginDefaults(printer.id, 'dummy-plugin', {
      a: 1,
      b: 2,
    });

    expect(store.getPluginSettings(printer.id, 'dummy-plugin')).toEqual({
      a: 1,
      b: 2,
    });

    store.setPluginSetting(printer.id, 'dummy-plugin', 'a', 100);

    store.applyPluginDefaults(printer.id, 'dummy-plugin', {
      a: 1,
      b: 2,
      c: 3,
    });

    expect(store.getPluginSettings(printer.id, 'dummy-plugin')).toEqual({
      a: 100,
      b: 2,
      c: 3,
    });
  });
});

describe('settings-store / legacy schema detection', () => {
  it('detects legacy keys but does not migrate them', () => {
    const storage = new MemoryStorage();

    storage.setItem('mpu:v1:printers', '[]');
    storage.setItem('printers', '[]');
    storage.setItem('settings:p1', '{}');
    storage.setItem(SETTINGS_STORAGE_KEYS.printers, '[]');

    const store = createSettingsStore({ storage });

    expect(store.legacy.detected).toBe(true);

    expect(store.legacy.keys).toContain('mpu:v1:printers');
    expect(store.legacy.keys).toContain('printers');
    expect(store.legacy.keys).toContain('settings:p1');

    expect(store.legacy.keys).not.toContain(SETTINGS_STORAGE_KEYS.printers);
  });

  it('clears legacy keys without touching v2 keys', () => {
    const storage = new MemoryStorage();

    storage.setItem('mpu:v1:printers', '[]');
    storage.setItem('printers', '[]');
    storage.setItem(SETTINGS_STORAGE_KEYS.printers, '[]');

    const store = createSettingsStore({ storage });

    store.clearLegacyKeys();

    expect(store.legacy.detected).toBe(false);
    expect(storage.getItem('mpu:v1:printers')).toBeNull();
    expect(storage.getItem('printers')).toBeNull();
    expect(storage.getItem(SETTINGS_STORAGE_KEYS.printers)).not.toBeNull();
  });

  it('exports legacy data as JSON-compatible object', () => {
    const storage = new MemoryStorage();

    storage.setItem('mpu:v1:ui', JSON.stringify({ theme: 'dark' }));
    storage.setItem('printers', 'raw-string');

    const store = createSettingsStore({ storage });

    const exported = store.getLegacyExportData();

    expect(exported['mpu:v1:ui']).toEqual({ theme: 'dark' });
    expect(exported['printers']).toBe('raw-string');
  });
});