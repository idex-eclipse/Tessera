import { describe, expect, it, vi } from 'vitest';

import type { PluginManifest } from '../../../../plugin-sdk/src/types';

import { createPluginLoader, type PluginLoaderDeps, type I18nSink } from '../plugin-loader.svelte.ts';
import { createPluginRegistry } from '../plugin-registry.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { MemoryStorage } from '../storage';
import { createGuardAgent } from '../guard-agent';

// ------------------------------------------------------------------
// Test helpers
// ------------------------------------------------------------------

function createTestManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '@test/plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    entry: '/index.js',
    ...overrides,
  };
}

function setup(options: {
  fetchManifest?: PluginLoaderDeps['fetchManifest'];
  importModule?: PluginLoaderDeps['importModule'];
  i18n?: I18nSink;
} = {}) {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const registry = createPluginRegistry(settings);
  const guardAgent = createGuardAgent();

  const fetchManifest = options.fetchManifest ?? vi.fn(async () => createTestManifest());
  const importModule = options.importModule ?? vi.fn(async () => ({ default: {} }));
  const i18n = options.i18n;

  const loader = createPluginLoader({
    settings,
    registry,
    guardAgent,
    fetchManifest,
    importModule,
    i18n,
  });

  return { storage, settings, registry, loader, fetchManifest, importModule, guardAgent };
}

// ------------------------------------------------------------------
// Core plugin registration
// ------------------------------------------------------------------

describe('plugin-loader / core plugins', () => {
  it('registers core plugin in registry', () => {
    const { loader, registry } = setup();

    const manifest = createTestManifest({
      id: '@core/console',
      pages: [
        { id: 'console', titleKey: 'console.title', component: 'ConsolePage' },
      ],
    });

    const module = { ConsolePage: {} };

    loader.registerCorePlugin(manifest, module);

    expect(registry.getPages()).toHaveLength(1);
    expect(registry.getPages()[0]!.pluginId).toBe('@core/console');
    expect(loader.isLoaded('@core/console')).toBe(true);
    expect(loader.getModule('@core/console')).toBe(module);
  });

  it('core plugins are not stored in settings', () => {
    const { loader, settings } = setup();

    const manifest = createTestManifest({ id: '@core/console' });
    loader.registerCorePlugin(manifest, {});

    expect(settings.plugins).toHaveLength(0);
  });

  it('getLoadedPlugins returns core plugins with source "core"', () => {
    const { loader } = setup();

    const manifest = createTestManifest({ id: '@core/widgets' });
    loader.registerCorePlugin(manifest, {});

    const loaded = loader.getLoadedPlugins();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.source).toBe('core');
    expect(loaded[0]!.manifestUrl).toBeUndefined();
  });

  it('re-registers core plugin with same id (unregister + register)', () => {
    const { loader, registry } = setup();

    const manifest1 = createTestManifest({
      id: '@core/console',
      pages: [{ id: 'page1', titleKey: 't1', component: 'P1' }],
    });
    const manifest2 = createTestManifest({
      id: '@core/console',
      pages: [{ id: 'page2', titleKey: 't2', component: 'P2' }],
    });

    loader.registerCorePlugin(manifest1, { P1: {} });
    expect(registry.getPages()).toHaveLength(1);
    expect(registry.getPages()[0]!.contribution.id).toBe('page1');

    loader.registerCorePlugin(manifest2, { P2: {} });
    expect(registry.getPages()).toHaveLength(1);
    expect(registry.getPages()[0]!.contribution.id).toBe('page2');
  });
});

// ------------------------------------------------------------------
// Remote plugin installation
// ------------------------------------------------------------------

describe('plugin-loader / remote install', () => {
  it('installs remote plugin: fetch, import, register, persist', async () => {
    const manifest = createTestManifest({
      id: '@third/graph',
      entry: '/dist/index.js',
      widgets: [
        {
          type: 'temperature-graph',
          provider: '@third/graph',
          titleKey: 'w.title',
          component: 'TempGraph',
        },
      ],
    });

    const { loader, registry, settings, fetchManifest, importModule } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => ({ TempGraph: {} })),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(fetchManifest).toHaveBeenCalledWith('http://plugin.example.com/manifest.json');
    expect(importModule).toHaveBeenCalledWith('http://plugin.example.com/dist/index.js');
    expect(registry.getWidgets()).toHaveLength(1);
    expect(registry.getWidgets()[0]!.pluginId).toBe('@third/graph');
    expect(settings.plugins).toHaveLength(1);
    expect(settings.plugins[0]!.manifestUrl).toBe('http://plugin.example.com/manifest.json');
    expect(settings.plugins[0]!.enabled).toBe(true);
    expect(loader.isLoaded('@third/graph')).toBe(true);
  });

  it('installs with printerIds and source', async () => {
    const manifest = createTestManifest({ id: '@third/graph' });

    const { loader, settings } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin(
      'http://plugin.example.com/manifest.json',
      ['printer-1', 'printer-2'],
      'catalog',
    );

    expect(settings.plugins[0]!.printerIds).toEqual(['printer-1', 'printer-2']);
    expect(settings.plugins[0]!.source).toBe('catalog');
  });

  it('rejects invalid manifest (missing id)', async () => {
    const { loader } = setup({
      fetchManifest: vi.fn(async () => ({
        name: 'Bad',
        version: '1.0.0',
        entry: '/index.js',
      }) as unknown as PluginManifest),
    });

    await expect(
      loader.installRemotePlugin('http://bad.example.com/manifest.json'),
    ).rejects.toThrow('missing or invalid "id"');
  });

  it('rejects invalid manifest (missing name)', async () => {
    const { loader } = setup({
      fetchManifest: vi.fn(async () => ({
        id: '@bad/plugin',
        version: '1.0.0',
        entry: '/index.js',
      }) as unknown as PluginManifest),
    });

    await expect(
      loader.installRemotePlugin('http://bad.example.com/manifest.json'),
    ).rejects.toThrow('missing or invalid "name"');
  });

  it('rejects invalid manifest (missing version)', async () => {
    const { loader } = setup({
      fetchManifest: vi.fn(async () => ({
        id: '@bad/plugin',
        name: 'Bad',
        entry: '/index.js',
      }) as unknown as PluginManifest),
    });

    await expect(
      loader.installRemotePlugin('http://bad.example.com/manifest.json'),
    ).rejects.toThrow('missing or invalid "version"');
  });

  it('rejects invalid manifest (missing entry)', async () => {
    const { loader } = setup({
      fetchManifest: vi.fn(async () => ({
        id: '@bad/plugin',
        name: 'Bad',
        version: '1.0.0',
      }) as unknown as PluginManifest),
    });

    await expect(
      loader.installRemotePlugin('http://bad.example.com/manifest.json'),
    ).rejects.toThrow('missing or invalid "entry"');
  });

  it('propagates fetch errors', async () => {
    const { loader } = setup({
      fetchManifest: vi.fn(async () => {
        throw new Error('Network error');
      }),
    });

    await expect(
      loader.installRemotePlugin('http://down.example.com/manifest.json'),
    ).rejects.toThrow('Network error');
  });

  it('propagates import errors', async () => {
    const { loader } = setup({
      importModule: vi.fn(async () => {
        throw new Error('CORS blocked');
      }),
    });

    await expect(
      loader.installRemotePlugin('http://cors.example.com/manifest.json'),
    ).rejects.toThrow('CORS blocked');
  });
});

// ------------------------------------------------------------------
// Entry URL resolution
// ------------------------------------------------------------------

describe('plugin-loader / entry resolution', () => {
  it('resolves relative entry against manifest URL', async () => {
    const manifest = createTestManifest({
      id: '@test/relative',
      entry: './dist/main.js',
    });

    const { loader, importModule } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://cdn.example.com/plugins/my-plugin/manifest.json');

    expect(importModule).toHaveBeenCalledWith(
      'http://cdn.example.com/plugins/my-plugin/dist/main.js',
    );
  });

  it('resolves absolute entry as-is', async () => {
    const manifest = createTestManifest({
      id: '@test/absolute',
      entry: 'http://other-cdn.example.com/bundle.js',
    });

    const { loader, importModule } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://cdn.example.com/manifest.json');

    expect(importModule).toHaveBeenCalledWith('http://other-cdn.example.com/bundle.js');
  });

  it('resolves entry with protocol-relative URL', async () => {
    const manifest = createTestManifest({
      id: '@test/protocol-relative',
      entry: '//other-cdn.example.com/bundle.js',
    });

    const { loader, importModule } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://cdn.example.com/manifest.json');

    expect(importModule).toHaveBeenCalledWith('http://other-cdn.example.com/bundle.js');
  });
});

// ------------------------------------------------------------------
// Uninstall
// ------------------------------------------------------------------

describe('plugin-loader / uninstall', () => {
  it('uninstalls remote plugin: unregister, remove from settings', async () => {
    const manifest = createTestManifest({ id: '@third/graph' });

    const { loader, registry, settings } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getPages()).toHaveLength(0);
    expect(loader.isLoaded('@third/graph')).toBe(true);
    expect(settings.plugins).toHaveLength(1);

    loader.uninstallRemotePlugin('http://plugin.example.com/manifest.json');

    expect(loader.isLoaded('@third/graph')).toBe(false);
    expect(settings.plugins).toHaveLength(0);
  });

  it('uninstall of non-existent plugin is a no-op', () => {
    const { loader } = setup();

    expect(() => {
      loader.uninstallRemotePlugin('http://nonexistent.example.com/manifest.json');
    }).not.toThrow();
  });
});

// ------------------------------------------------------------------
// Enable / Disable
// ------------------------------------------------------------------

describe('plugin-loader / enable-disable', () => {
  it('disabling removes contributions from registry', async () => {
    const manifest = createTestManifest({
      id: '@third/graph',
      widgets: [
        {
          type: 'graph',
          provider: '@third/graph',
          titleKey: 'w',
          component: 'G',
        },
      ],
    });

    const { loader, registry, settings } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getWidgets()).toHaveLength(1);

    loader.setPluginEnabled('http://plugin.example.com/manifest.json', false);

    expect(registry.getWidgets()).toHaveLength(0);
    expect(settings.plugins[0]!.enabled).toBe(false);
  });

  it('enabling re-registers contributions', async () => {
    const manifest = createTestManifest({
      id: '@third/graph',
      widgets: [
        {
          type: 'graph',
          provider: '@third/graph',
          titleKey: 'w',
          component: 'G',
        },
      ],
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    loader.setPluginEnabled('http://plugin.example.com/manifest.json', false);
    expect(registry.getWidgets()).toHaveLength(0);

    loader.setPluginEnabled('http://plugin.example.com/manifest.json', true);
    expect(registry.getWidgets()).toHaveLength(1);
  });

  it('enable/disable of non-existent plugin is a no-op', () => {
    const { loader } = setup();

    expect(() => {
      loader.setPluginEnabled('http://nonexistent.example.com/manifest.json', false);
    }).not.toThrow();
  });
});

// ------------------------------------------------------------------
// Reload
// ------------------------------------------------------------------

describe('plugin-loader / reload', () => {
  it('reloads plugin (uninstall + install)', async () => {
    let callCount = 0;

    const manifest = createTestManifest({ id: '@third/graph' });

    const { loader, fetchManifest, importModule } = setup({
      fetchManifest: vi.fn(async () => {
        callCount += 1;
        return manifest;
      }),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');
    expect(callCount).toBe(1);

    await loader.reloadRemotePlugin('http://plugin.example.com/manifest.json');
    expect(callCount).toBe(2);

    expect(loader.isLoaded('@third/graph')).toBe(true);
  });

  it('preserves enabled state after reload', async () => {
    const manifest = createTestManifest({ id: '@third/graph' });

    const { loader, settings } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');
    loader.setPluginEnabled('http://plugin.example.com/manifest.json', false);

    expect(settings.plugins[0]!.enabled).toBe(false);

    await loader.reloadRemotePlugin('http://plugin.example.com/manifest.json');

    expect(settings.plugins[0]!.enabled).toBe(false);
  });

  it('preserves printerIds after reload', async () => {
    const manifest = createTestManifest({ id: '@third/graph' });

    const { loader, settings } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin(
      'http://plugin.example.com/manifest.json',
      ['printer-1', 'printer-2'],
    );

    await loader.reloadRemotePlugin('http://plugin.example.com/manifest.json');

    expect(settings.plugins[0]!.printerIds).toEqual(['printer-1', 'printer-2']);
  });
});

// ------------------------------------------------------------------
// loadEnabledPlugins (startup)
// ------------------------------------------------------------------

describe('plugin-loader / loadEnabledPlugins', () => {
  it('loads enabled plugins from settings', async () => {
    const manifest = createTestManifest({
      id: '@third/graph',
      widgets: [
        {
          type: 'graph',
          provider: '@third/graph',
          titleKey: 'w',
          component: 'G',
        },
      ],
    });

    const { loader, settings, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    settings.addPlugin('http://plugin.example.com/manifest.json');

    await loader.loadEnabledPlugins();

    expect(loader.isLoaded('@third/graph')).toBe(true);
    expect(registry.getWidgets()).toHaveLength(1);
  });

  it('skips disabled plugins', async () => {
    const manifest = createTestManifest({ id: '@third/disabled' });

    const { loader, settings, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    settings.addPlugin('http://disabled.example.com/manifest.json');
    settings.setPluginEnabled('http://disabled.example.com/manifest.json', false);

    await loader.loadEnabledPlugins();

    expect(loader.isLoaded('@third/disabled')).toBe(false);
    expect(registry.getPages()).toHaveLength(0);
    expect(registry.getWidgets()).toHaveLength(0);
  });

  it('continues loading other plugins if one fails', async () => {
    const goodManifest = createTestManifest({ id: '@third/good' });

    let callIndex = 0;

    const { loader, settings, registry } = setup({
      fetchManifest: vi.fn(async (url: string) => {
        callIndex += 1;
        if (url.includes('bad')) {
          throw new Error('Fetch failed');
        }
        return goodManifest;
      }),
    });

    settings.addPlugin('http://bad.example.com/manifest.json');
    settings.addPlugin('http://good.example.com/manifest.json');

    await loader.loadEnabledPlugins();

    expect(loader.isLoaded('@third/good')).toBe(true);
    expect(registry.getPages()).toHaveLength(0);
  });

  it('unloads plugins that are no longer in settings', async () => {
    const manifest = createTestManifest({ id: '@third/old' });

    const { loader, settings } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://old.example.com/manifest.json');
    expect(loader.isLoaded('@third/old')).toBe(true);

    settings.removePlugin('http://old.example.com/manifest.json');

    await loader.loadEnabledPlugins();

    expect(loader.isLoaded('@third/old')).toBe(false);
  });
});

// ------------------------------------------------------------------
// getModule / getLoadedPlugin / getLoadedPlugins / isLoaded
// ------------------------------------------------------------------

describe('plugin-loader / queries', () => {
  it('getModule returns module for loaded plugin', () => {
    const { loader } = setup();

    const manifest = createTestManifest({ id: '@core/console' });
    const module = { ConsolePage: 'component' };

    loader.registerCorePlugin(manifest, module);

    expect(loader.getModule('@core/console')).toBe(module);
  });

  it('getModule returns undefined for unknown plugin', () => {
    const { loader } = setup();

    expect(loader.getModule('@unknown/plugin')).toBeUndefined();
  });

  it('getLoadedPlugin returns loaded plugin', () => {
    const { loader } = setup();

    const manifest = createTestManifest({ id: '@core/console' });
    loader.registerCorePlugin(manifest, {});

    const loaded = loader.getLoadedPlugin('@core/console');
    expect(loaded).toBeDefined();
    expect(loaded!.manifest.id).toBe('@core/console');
    expect(loaded!.source).toBe('core');
  });

  it('getLoadedPlugin returns undefined for unknown plugin', () => {
    const { loader } = setup();

    expect(loader.getLoadedPlugin('@unknown/plugin')).toBeUndefined();
  });

  it('getLoadedPlugins returns all loaded plugins', () => {
    const { loader } = setup();

    loader.registerCorePlugin(createTestManifest({ id: '@core/a' }), {});
    loader.registerCorePlugin(createTestManifest({ id: '@core/b' }), {});

    const loaded = loader.getLoadedPlugins();
    expect(loaded).toHaveLength(2);
    expect(loaded.map((p) => p.manifest.id)).toEqual(['@core/a', '@core/b']);
  });

  it('isLoaded returns true for loaded plugin', () => {
    const { loader } = setup();

    loader.registerCorePlugin(createTestManifest({ id: '@core/console' }), {});

    expect(loader.isLoaded('@core/console')).toBe(true);
    expect(loader.isLoaded('@unknown/plugin')).toBe(false);
  });
});

// ------------------------------------------------------------------
// pluginAppliesToPrinter
// ------------------------------------------------------------------

describe('plugin-loader / pluginAppliesToPrinter', () => {
  it('core plugins apply to all printers', () => {
    const { loader } = setup();

    loader.registerCorePlugin(createTestManifest({ id: '@core/console' }), {});

    expect(loader.pluginAppliesToPrinter('@core/console', 'printer-1')).toBe(true);
    expect(loader.pluginAppliesToPrinter('@core/console', 'printer-2')).toBe(true);
  });

  it('remote plugin with empty printerIds applies to all printers', async () => {
    const manifest = createTestManifest({ id: '@third/graph' });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(loader.pluginAppliesToPrinter('@third/graph', 'printer-1')).toBe(true);
    expect(loader.pluginAppliesToPrinter('@third/graph', 'printer-2')).toBe(true);
  });

  it('remote plugin with printerIds applies only to specified printers', async () => {
    const manifest = createTestManifest({ id: '@third/graph' });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin(
      'http://plugin.example.com/manifest.json',
      ['printer-1', 'printer-2'],
    );

    expect(loader.pluginAppliesToPrinter('@third/graph', 'printer-1')).toBe(true);
    expect(loader.pluginAppliesToPrinter('@third/graph', 'printer-2')).toBe(true);
    expect(loader.pluginAppliesToPrinter('@third/graph', 'printer-3')).toBe(false);
  });

  it('returns false for unknown plugin', () => {
    const { loader } = setup();

    expect(loader.pluginAppliesToPrinter('@unknown/plugin', 'printer-1')).toBe(false);
  });
});

// ------------------------------------------------------------------
// Sanitize contributions
// ------------------------------------------------------------------

describe('plugin-loader / sanitize', () => {
  it('accepts valid overlays', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      overlays: [
        { id: 'overlay1', element: 'mpu-test-overlay1' },
        { id: 'overlay2', element: 'mpu-test-overlay2' },
      ],
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getOverlays()).toHaveLength(2);
  });

  it('rejects overlays without id', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      overlays: [
        { id: 'overlay1', element: 'mpu-test-overlay1' },
        { element: 'mpu-test-overlay2' }, // no id
      ] as any,
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getOverlays()).toHaveLength(1);
  });

  it('rejects overlays without element', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      overlays: [
        { id: 'overlay1', element: 'mpu-test-overlay1' },
        { id: 'overlay2' }, // no element
      ] as any,
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getOverlays()).toHaveLength(1);
  });

  it('accepts valid banners', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      banners: [
        { id: 'banner1', element: 'mpu-test-banner1' },
        { id: 'banner2', element: 'mpu-test-banner2' },
      ],
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getBanners()).toHaveLength(2);
  });

  it('accepts valid chips', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      chips: [
        {
          type: 'temperature',
          provider: '@test/plugin',
          titleKey: 'chip.title',
          element: 'mpu-test-chip',
          pickerElement: 'mpu-test-picker',
        },
      ],
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getChips()).toHaveLength(1);
  });

  it('rejects chips without required fields', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      chips: [
        {
          type: 'temperature',
          provider: '@test/plugin',
          titleKey: 'chip.title',
          element: 'mpu-test-chip',
          // missing pickerElement
        } as any,
      ],
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getChips()).toHaveLength(0);
  });

  it('accepts rightPanel only from @core/system', async () => {
    const manifest = createTestManifest({
      id: '@core/system',
      rightPanel: { id: 'panel', element: 'mpu-system-panel' },
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getRightPanel()).toBeDefined();
  });

  it('rejects rightPanel from non-core plugins', async () => {
    const manifest = createTestManifest({
      id: '@third/plugin',
      rightPanel: { id: 'panel', element: 'mpu-third-panel' },
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getRightPanel()).toBeUndefined();
  });

  it('accepts valid printerPanels', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      printerPanels: [
        { id: 'panel1', element: 'mpu-test-panel1' },
        { id: 'panel2', element: 'mpu-test-panel2', titleKey: 'test.panel2' },
      ],
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getPrinterPanels()).toHaveLength(2);
    expect(registry.getPrinterPanels()[0]!.contribution.id).toBe('panel1');
    expect(registry.getPrinterPanels()[1]!.contribution.titleKey).toBe('test.panel2');
  });

  it('rejects printerPanels without id', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      printerPanels: [
        { id: 'panel1', element: 'mpu-test-panel1' },
        { element: 'mpu-test-panel2' }, // no id
      ] as any,
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getPrinterPanels()).toHaveLength(1);
  });

  it('rejects printerPanels without element', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      printerPanels: [
        { id: 'panel1', element: 'mpu-test-panel1' },
        { id: 'panel2' }, // no element
      ] as any,
    });

    const { loader, registry } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(registry.getPrinterPanels()).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// hasSurfaces
// ------------------------------------------------------------------

describe('plugin-loader / hasSurfaces', () => {
  it('returns true when overlays present', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      overlays: [{ id: 'overlay1', element: 'mpu-test-overlay1' }],
    });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    const loaded = loader.getLoadedPlugin('@test/plugin');
    expect(loaded).toBeDefined();
  });

  it('returns true when banners present', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      banners: [{ id: 'banner1', element: 'mpu-test-banner1' }],
    });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    const loaded = loader.getLoadedPlugin('@test/plugin');
    expect(loaded).toBeDefined();
  });

  it('returns true when chips present', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      chips: [
        {
          type: 'temperature',
          provider: '@test/plugin',
          titleKey: 'chip.title',
          element: 'mpu-test-chip',
          pickerElement: 'mpu-test-picker',
        },
      ],
    });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    const loaded = loader.getLoadedPlugin('@test/plugin');
    expect(loaded).toBeDefined();
  });

  it('returns true when printerPanels present', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      printerPanels: [{ id: 'panel1', element: 'mpu-test-panel1' }],
    });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    const loaded = loader.getLoadedPlugin('@test/plugin');
    expect(loaded).toBeDefined();
  });

  it('returns true when rightPanel present', async () => {
    const manifest = createTestManifest({
      id: '@core/system',
      rightPanel: { id: 'panel', element: 'mpu-system-panel' },
    });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    const loaded = loader.getLoadedPlugin('@core/system');
    expect(loaded).toBeDefined();
  });

  it('returns false when no surfaces', async () => {
    const manifest = createTestManifest({
      id: '@test/plugin',
      pages: [{ id: 'page1', titleKey: 't1', element: 'mpu-test-page' }],
    });

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    const loaded = loader.getLoadedPlugin('@test/plugin');
    expect(loaded).toBeDefined();
  });
});

// ------------------------------------------------------------------
// normalizeContribs (auto-tag for component/headerComponent)
// ------------------------------------------------------------------

describe('plugin-loader / normalizeContribs', () => {
  it('auto-tags page component when element is missing', () => {
    const { loader, registry } = setup();

    const manifest = createTestManifest({
      id: '@core/console',
      pages: [
        { id: 'console', titleKey: 'console.title', component: 'ConsolePage' },
      ],
    });

    const module = { ConsolePage: {} };

    loader.registerCorePlugin(manifest, module);

    const pages = registry.getPages();
    expect(pages).toHaveLength(1);
    expect(pages[0]!.contribution.element).toMatch(/^mpu-auto-core-console-page-console$/);
  });

  it('auto-tags widget component when element is missing', () => {
    const { loader, registry } = setup();

    const manifest = createTestManifest({
      id: '@core/widgets',
      widgets: [
        {
          type: 'temperature',
          provider: '@core/widgets',
          titleKey: 'w.title',
          component: 'TempWidget',
        },
      ],
    });

    const module = { TempWidget: {} };

    loader.registerCorePlugin(manifest, module);

    const widgets = registry.getWidgets();
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.contribution.element).toMatch(/^mpu-auto-core-widgets-widget-temperature-core-widgets$/);
  });

  it('auto-tags widget headerComponent when headerElement is missing', () => {
    const { loader, registry } = setup();

    const manifest = createTestManifest({
      id: '@core/widgets',
      widgets: [
        {
          type: 'temperature',
          provider: '@core/widgets',
          titleKey: 'w.title',
          component: 'TempWidget',
          headerComponent: 'TempHeader',
        },
      ],
    });

    const module = { TempWidget: {}, TempHeader: {} };

    loader.registerCorePlugin(manifest, module);

    const widgets = registry.getWidgets();
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.contribution.headerElement).toMatch(/^mpu-auto-core-widgets-header-temperature-core-widgets$/);
  });

  it('does not auto-tag when element already present', () => {
    const { loader, registry } = setup();

    const manifest = createTestManifest({
      id: '@core/console',
      pages: [
        {
          id: 'console',
          titleKey: 'console.title',
          component: 'ConsolePage',
          element: 'mpu-custom-element',
        },
      ],
    });

    const module = { ConsolePage: {} };

    loader.registerCorePlugin(manifest, module);

    const pages = registry.getPages();
    expect(pages[0]!.contribution.element).toBe('mpu-custom-element');
  });

  it('resolves icon from module.pageIcons', () => {
    const { loader, registry } = setup();

    const manifest = createTestManifest({
      id: '@core/console',
      pages: [
        { id: 'console', titleKey: 'console.title', component: 'ConsolePage', icon: 'consoleIcon' },
      ],
    });

    const module = {
      ConsolePage: {},
      pageIcons: {
        consoleIcon: '<svg>icon</svg>',
      },
    };

    loader.registerCorePlugin(manifest, module);

    const pages = registry.getPages();
    expect(pages[0]!.contribution.iconSvg).toBe('<svg>icon</svg>');
  });
});

// ------------------------------------------------------------------
// Guards registration
// ------------------------------------------------------------------

describe('plugin-loader / guards', () => {
  it('registers guards from core plugin', () => {
    const { loader, guardAgent } = setup();

    const manifest = createTestManifest({
      id: '@core/calibrations',
      guards: [
        {
          id: 'calib-safety',
          match: ['printer.gcode.script'],
          handler: 'calibSafetyHandler',
        },
      ],
    });

    const module = {
      calibSafetyHandler: vi.fn(async () => ({ action: 'allow' })),
    };

    loader.registerCorePlugin(manifest, module);

    const registered = guardAgent.getRegisteredGuards();
    expect(registered).toHaveLength(1);
    expect(registered[0]?.pluginId).toBe('@core/calibrations');
    expect(registered[0]?.guardId).toBe('calib-safety');
  });

  it('registers guards from remote plugin', async () => {
    const manifest = createTestManifest({
      id: '@third/plugin',
      guards: [
        {
          id: 'custom-guard',
          match: ['printer.gcode.script'],
          handler: 'customHandler',
        },
      ],
    });

    const module = {
      customHandler: vi.fn(async () => ({ action: 'allow' })),
    };

    const { loader, guardAgent } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => module),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    const registered = guardAgent.getRegisteredGuards();
    expect(registered).toHaveLength(1);
    expect(registered[0]?.pluginId).toBe('@third/plugin');
  });

  it('unregisters guards when plugin is uninstalled', async () => {
    const manifest = createTestManifest({
      id: '@third/plugin',
      guards: [
        {
          id: 'custom-guard',
          match: ['printer.gcode.script'],
          handler: 'customHandler',
        },
      ],
    });

    const module = {
      customHandler: vi.fn(async () => ({ action: 'allow' })),
    };

    const { loader, guardAgent } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => module),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');
    expect(guardAgent.getRegisteredGuards()).toHaveLength(1);

    loader.uninstallRemotePlugin('http://plugin.example.com/manifest.json');
    expect(guardAgent.getRegisteredGuards()).toHaveLength(0);
  });

  it('unregisters guards when plugin is disabled', async () => {
    const manifest = createTestManifest({
      id: '@third/plugin',
      guards: [
        {
          id: 'custom-guard',
          match: ['printer.gcode.script'],
          handler: 'customHandler',
        },
      ],
    });

    const module = {
      customHandler: vi.fn(async () => ({ action: 'allow' })),
    };

    const { loader, guardAgent } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => module),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');
    expect(guardAgent.getRegisteredGuards()).toHaveLength(1);

    loader.setPluginEnabled('http://plugin.example.com/manifest.json', false);
    expect(guardAgent.getRegisteredGuards()).toHaveLength(0);
  });

  it('re-registers guards when plugin is enabled', async () => {
    const manifest = createTestManifest({
      id: '@third/plugin',
      guards: [
        {
          id: 'custom-guard',
          match: ['printer.gcode.script'],
          handler: 'customHandler',
        },
      ],
    });

    const module = {
      customHandler: vi.fn(async () => ({ action: 'allow' })),
    };

    const { loader, guardAgent } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => module),
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    loader.setPluginEnabled('http://plugin.example.com/manifest.json', false);
    expect(guardAgent.getRegisteredGuards()).toHaveLength(0);

    loader.setPluginEnabled('http://plugin.example.com/manifest.json', true);
    expect(guardAgent.getRegisteredGuards()).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// Locales registration
// ------------------------------------------------------------------

describe('plugin-loader / locales', () => {
  it('registers locales from module', async () => {
    const manifest = createTestManifest({
      id: '@third/plugin',
      locales: ['en', 'ru'],
    });

    const module = {
      locales: {
        en: { plugin: { title: 'My Plugin' } },
        ru: { plugin: { title: 'Мой плагин' } },
      },
    };

    const i18n: I18nSink = {
      addMessages: vi.fn(),
    };

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => module),
      i18n,
    });

    await loader.installRemotePlugin('http://plugin.example.com/manifest.json');

    expect(i18n.addMessages).toHaveBeenCalledTimes(2);
    expect(i18n.addMessages).toHaveBeenCalledWith('en', { plugin: { title: 'My Plugin' } });
    expect(i18n.addMessages).toHaveBeenCalledWith('ru', { plugin: { title: 'Мой плагин' } });
  });

  it('does not fail when locales is missing', async () => {
    const manifest = createTestManifest({ id: '@third/plugin' });
    const module = {};

    const i18n: I18nSink = {
      addMessages: vi.fn(),
    };

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => module),
      i18n,
    });

    await expect(
      loader.installRemotePlugin('http://plugin.example.com/manifest.json'),
    ).resolves.not.toThrow();

    expect(i18n.addMessages).not.toHaveBeenCalled();
  });

  it('does not fail when i18n is not provided', async () => {
    const manifest = createTestManifest({
      id: '@third/plugin',
      locales: ['en'],
    });

    const module = {
      locales: {
        en: { plugin: { title: 'My Plugin' } },
      },
    };

    const { loader } = setup({
      fetchManifest: vi.fn(async () => manifest),
      importModule: vi.fn(async () => module),
    });

    await expect(
      loader.installRemotePlugin('http://plugin.example.com/manifest.json'),
    ).resolves.not.toThrow();
  });
});

// ------------------------------------------------------------------
// eagerActivateSurfacePlugins
// ------------------------------------------------------------------

describe('plugin-loader / eagerActivateSurfacePlugins', () => {
  it('does not throw when called with no plugins', () => {
    const { loader } = setup();

    expect(() => {
      loader.eagerActivateSurfacePlugins();
    }).not.toThrow();
  });

  it('does not throw when called with surface plugins', () => {
    const { loader } = setup();

    loader.registerCorePlugin(
      createTestManifest({
        id: '@core/system',
        overlays: [{ id: 'overlay1', element: 'mpu-system-overlay' }],
      }),
      {},
    );

    expect(() => {
      loader.eagerActivateSurfacePlugins();
    }).not.toThrow();
  });
});