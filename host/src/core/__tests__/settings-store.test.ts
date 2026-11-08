import { describe, expect, it } from 'vitest';

import { MemoryStorage } from '../storage';

import {
  createSettingsStore,
  pluginSettingsStorageKey,
  printerSettingsStorageKey,
  RIGHT_PANEL_DEFAULT_WIDTH,
  SETTINGS_STORAGE_KEYS,
  FONT_MAX_CHARS,
  normalizeCustomFont,
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
      accent: null,
      logoAnimated: true,
      bgImage: null,
      theme: 'light',
      highContrast: false,
      fontScale: 100,
      letterSpacing: 0,
      glyphWidth: 0,
      locale: 'en',
      rightPanelCollapsed: false,
      rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
      dir: 'ltr',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      fleetOpen: false,
      fleetPanels: [],
      fleetPanelsCustomized: false,
      hotkeyOverrides: {},
      extensionResolutions: {},
      notifications: { ignoredPatterns: [], soundEnabled: false },
      updateCheck: { intervalHours: 4, lastCheckedAt: 0, notified: {} },
    });
  });

  it('keeps the update check interval between 1 and 168 hours', () => {
    const store = createSettingsStore({ storage: new MemoryStorage() });

    expect(store.ui.updateCheck.intervalHours).toBe(4);
    store.setUpdateCheckSettings({ intervalHours: 0 });
    expect(store.ui.updateCheck.intervalHours).toBe(1);
    store.setUpdateCheckSettings({ intervalHours: 9999 });
    expect(store.ui.updateCheck.intervalHours).toBe(168);
    store.setUpdateCheckSettings({ intervalHours: Number.NaN });
    expect(store.ui.updateCheck.intervalHours).toBe(4);
    store.setUpdateCheckSettings({ intervalHours: 6.4 });
    expect(store.ui.updateCheck.intervalHours).toBe(6);
  });

  it('repairs a stored update check state', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SETTINGS_STORAGE_KEYS.ui,
      JSON.stringify({ updateCheck: { intervalHours: 0.2, lastCheckedAt: -5, notified: { ui: 'abc', bad: 1 } } }),
    );

    const store = createSettingsStore({ storage });

    expect(store.ui.updateCheck).toEqual({ intervalHours: 1, lastCheckedAt: 0, notified: { ui: 'abc' } });
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
  it('rejects corrupt or oversized font data', () => {
    expect(normalizeCustomFont({ name: 'bad.ttf', dataUrl: 'data:text/plain;base64,AAAA' })).toBeNull();
    expect(normalizeCustomFont({ name: 'large.woff', dataUrl: `data:font/woff;base64,${'A'.repeat(FONT_MAX_CHARS)}` })).toBeNull();
    const { store } = setup();
    expect(store.setCustomFont({ name: 'bad.ttf', dataUrl: 'invalid' })).toBe(false);
    expect(store.customFont).toBeNull();
  });

  it('normalizes accessibility settings and stores the font separately', () => {
    const { storage, store } = setup();
    store.setHighContrast(true);
    store.setFontScale(147);
    store.setLetterSpacing(7);
    store.setGlyphWidth(20);
    expect(store.ui.highContrast).toBe(true);
    expect(store.ui.fontScale).toBe(150);
    expect(store.ui.letterSpacing).toBe(8);
    expect(store.ui.glyphWidth).toBe(6);
    const restored = createSettingsStore({ storage });
    expect(restored.ui.letterSpacing).toBe(8);
    expect(restored.ui.glyphWidth).toBe(6);
    const font = { name: 'test.woff2', dataUrl: 'data:font/woff2;base64,d09GMg==' };
    expect(store.setCustomFont(font)).toBe(true);
    expect(store.customFont).toEqual(font);
    expect(storage.getItem(SETTINGS_STORAGE_KEYS.ui)).not.toContain('data:font');
    expect(storage.getItem(SETTINGS_STORAGE_KEYS.customFont)).toContain('data:font');
    store.setCustomFont(null);
    expect(store.customFont).toBeNull();
  });

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

describe('settings-store / logo animation', () => {
  it('is on by default and remembers being stopped', () => {
    const storage = new MemoryStorage();
    const store = createSettingsStore({ storage });
    expect(store.ui.logoAnimated).toBe(true);

    store.setLogoAnimated(false);
    expect(createSettingsStore({ storage }).ui.logoAnimated).toBe(false);
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
describe('settings-store / reload from storage', () => {
  it('picks up settings written to storage behind its back and notifies plugin subscribers', () => {
    const { storage, store } = setup();
    const p = store.addPrinter({ name: 'A', url: 'http://a:7125' });
    const seen: unknown[] = [];
    store.onPluginSettingsChange(p.id, 'tessera/x', (s) => seen.push(s));
    expect(store.getPageVisibility(p.id, 'jobs')).toBe(true);

    storage.setItem(
      pluginSettingsStorageKey(p.id, 'tessera/x'),
      JSON.stringify({ values: { k: 1 } }),
    );
    storage.setItem(printerSettingsStorageKey(p.id), JSON.stringify({ pages: { jobs: false } }));
    storage.setItem(SETTINGS_STORAGE_KEYS.ui, JSON.stringify({ theme: 'light' }));
    store.reloadFromStorage();

    expect(store.getPageVisibility(p.id, 'jobs')).toBe(false);
    expect(store.ui.theme).toBe('light');
    expect(seen.length).toBe(1);
  });

  it('tells subscribers when the active printer changes', () => {
    const { store } = setup();
    const a = store.addPrinter({ name: 'A', url: 'http://a:7125' });
    const b = store.addPrinter({ name: 'B', url: 'http://b:7125' });
    const ids: Array<string | null> = [];
    const off = store.onActivePrinterChange((id) => ids.push(id));
    store.setActivePrinter(b.id);
    store.setActivePrinter(a.id);
    off();
    store.setActivePrinter(b.id);
    expect(ids).toEqual([b.id, a.id]);
  });
});
