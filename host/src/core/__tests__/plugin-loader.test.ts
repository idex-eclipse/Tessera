import { describe, expect, it, vi } from 'vitest';

import type { PluginManifest } from '../../../../plugin-sdk/src/types';

import { createPluginLoader, type PluginLoaderDeps } from '../plugin-loader.svelte.ts';
import { createPluginRegistry } from '../plugin-registry.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { MemoryStorage } from '../storage';

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
} = {}) {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const registry = createPluginRegistry(settings);

  const fetchManifest = options.fetchManifest ?? vi.fn(async () => createTestManifest());
  const importModule = options.importModule ?? vi.fn(async () => ({ default: {} }));

  const loader = createPluginLoader({
    settings,
    registry,
    fetchManifest,
    importModule,
  });

  return { storage, settings, registry, loader, fetchManifest, importModule };
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

    // Fetch was called with manifest URL
    expect(fetchManifest).toHaveBeenCalledWith('http://plugin.example.com/manifest.json');

    // Import was called with entry resolved relative to manifest
    expect(importModule).toHaveBeenCalledWith('http://plugin.example.com/dist/index.js');

    // Registered in registry
    expect(registry.getWidgets()).toHaveLength(1);
    expect(registry.getWidgets()[0]!.pluginId).toBe('@third/graph');

    // Persisted in settings
    expect(settings.plugins).toHaveLength(1);
    expect(settings.plugins[0]!.manifestUrl).toBe('http://plugin.example.com/manifest.json');
    expect(settings.plugins[0]!.enabled).toBe(true);

    // Loaded state
    expect(loader.isLoaded('@third/graph')).toBe(true);
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

    // Simulate previously installed plugin in settings
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
});

// ------------------------------------------------------------------
// getModule
// ------------------------------------------------------------------

describe('plugin-loader / getModule', () => {
  it('returns module for loaded plugin', () => {
    const { loader } = setup();

    const manifest = createTestManifest({ id: '@core/console' });
    const module = { ConsolePage: 'component' };

    loader.registerCorePlugin(manifest, module);

    expect(loader.getModule('@core/console')).toBe(module);
  });

  it('returns undefined for unknown plugin', () => {
    const { loader } = setup();

    expect(loader.getModule('@unknown/plugin')).toBeUndefined();
  });
});