import { describe, expect, it } from 'vitest';

import type { PluginManifest } from '../../../../plugin-sdk/src/types';

import { createPluginRegistry } from '../plugin-registry.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { MemoryStorage } from '../storage';

// ------------------------------------------------------------------
// Test helpers
// ------------------------------------------------------------------

function createManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '@test/plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    entry: '/plugins/test/index.js',
    ...overrides,
  };
}

function setup() {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const registry = createPluginRegistry(settings);

  return { storage, settings, registry };
}

// ------------------------------------------------------------------
// Registration
// ------------------------------------------------------------------

describe('plugin-registry / registration', () => {
  it('registers pages from manifest', () => {
    const { registry } = setup();

    registry.registerPlugin(
      createManifest({
        id: '@core/console',
        pages: [
          {
            id: 'console',
            titleKey: 'console.title',
            component: 'ConsolePage',
          },
        ],
      }),
    );

    const pages = registry.getPages();

    expect(pages).toHaveLength(1);
    expect(pages[0]!.pluginId).toBe('@core/console');
    expect(pages[0]!.contribution.id).toBe('console');
  });

  it('registers widgets from manifest', () => {
    const { registry } = setup();

    registry.registerPlugin(
      createManifest({
        id: '@core/widgets',
        widgets: [
          {
            type: 'temperature-graph',
            provider: '@core/widgets',
            titleKey: 'widgets.temperatureGraph',
            component: 'TemperatureGraph',
            defaultSize: { w: 4, h: 3 },
          },
        ],
      }),
    );

    const widgets = registry.getWidgets();

    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.pluginId).toBe('@core/widgets');
    expect(widgets[0]!.contribution.type).toBe('temperature-graph');
  });

  it('unregisters plugin contributions', () => {
    const { registry } = setup();

    registry.registerPlugin(
      createManifest({
        id: '@core/console',
        pages: [
          { id: 'console', titleKey: 'console.title', component: 'ConsolePage' },
        ],
        widgets: [
          {
            type: 'status',
            provider: '@core/console',
            titleKey: 'widgets.status',
            component: 'StatusWidget',
          },
        ],
      }),
    );

    expect(registry.getPages()).toHaveLength(1);
    expect(registry.getWidgets()).toHaveLength(1);

    registry.unregisterPlugin('@core/console');

    expect(registry.getPages()).toHaveLength(0);
    expect(registry.getWidgets()).toHaveLength(0);
  });

  it('re-register is idempotent (no duplicates)', () => {
    const { registry } = setup();

    const manifest = createManifest({
      id: '@core/console',
      pages: [
        { id: 'console', titleKey: 'console.title', component: 'ConsolePage' },
      ],
    });

    registry.registerPlugin(manifest);
    registry.registerPlugin(manifest);

    expect(registry.getPages()).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// Widget types and providers
// ------------------------------------------------------------------

describe('plugin-registry / widget types and providers', () => {
  it('returns unique sorted widget types', () => {
    const { registry } = setup();

    registry.registerPlugin(
      createManifest({
        id: '@core/widgets',
        widgets: [
          {
            type: 'temperature-graph',
            provider: '@core/widgets',
            titleKey: 'w1',
            component: 'C1',
          },
          {
            type: 'status',
            provider: '@core/widgets',
            titleKey: 'w2',
            component: 'C2',
          },
        ],
      }),
    );

    registry.registerPlugin(
      createManifest({
        id: '@third/widgets',
        widgets: [
          {
            type: 'temperature-graph',
            provider: '@third/widgets',
            titleKey: 'w3',
            component: 'C3',
          },
        ],
      }),
    );

    const types = registry.getWidgetTypes();

    expect(types).toEqual(['status', 'temperature-graph']);
  });

  it('returns providers for a given type', () => {
    const { registry } = setup();

    registry.registerPlugin(
      createManifest({
        id: '@core/widgets',
        widgets: [
          {
            type: 'temperature-graph',
            provider: '@core/widgets',
            titleKey: 'w1',
            component: 'C1',
          },
        ],
      }),
    );

    registry.registerPlugin(
      createManifest({
        id: '@third/graph',
        widgets: [
          {
            type: 'temperature-graph',
            provider: '@third/graph',
            titleKey: 'w2',
            component: 'C2',
          },
        ],
      }),
    );

    const providers = registry.getProvidersForType('temperature-graph');

    expect(providers).toHaveLength(2);
    expect(providers[0]!.contribution.provider).toBe('@core/widgets');
    expect(providers[1]!.contribution.provider).toBe('@third/graph');
  });

  it('detects multiple providers', () => {
    const { registry } = setup();

    registry.registerPlugin(
      createManifest({
        id: '@core/widgets',
        widgets: [
          {
            type: 'camera',
            provider: '@core/widgets',
            titleKey: 'w1',
            component: 'C1',
          },
        ],
      }),
    );

    expect(registry.hasMultipleProviders('camera')).toBe(false);

    registry.registerPlugin(
      createManifest({
        id: '@third/cam',
        widgets: [
          {
            type: 'camera',
            provider: '@third/cam',
            titleKey: 'w2',
            component: 'C2',
          },
        ],
      }),
    );

    expect(registry.hasMultipleProviders('camera')).toBe(true);
  });
});

// ------------------------------------------------------------------
// Effective provider resolution
// ------------------------------------------------------------------

describe('plugin-registry / effective provider', () => {
  it('returns the only provider when there is one', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    registry.registerPlugin(
      createManifest({
        id: '@core/widgets',
        widgets: [
          {
            type: 'status',
            provider: '@core/widgets',
            titleKey: 'w',
            component: 'C',
          },
        ],
      }),
    );

    const effective = registry.getEffectiveProvider(printer.id, 'status');

    expect(effective).not.toBeNull();
    expect(effective!.contribution.provider).toBe('@core/widgets');
  });

  it('uses user selection when multiple providers exist', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    registry.registerPlugin(
      createManifest({
        id: '@core/widgets',
        widgets: [
          {
            type: 'temperature-graph',
            provider: '@core/widgets',
            titleKey: 'w1',
            component: 'C1',
          },
        ],
      }),
    );

    registry.registerPlugin(
      createManifest({
        id: '@third/graph',
        widgets: [
          {
            type: 'temperature-graph',
            provider: '@third/graph',
            titleKey: 'w2',
            component: 'C2',
          },
        ],
      }),
    );

    // Without explicit selection, falls back to first.
    const fallback = registry.getEffectiveProvider(printer.id, 'temperature-graph');
    expect(fallback!.contribution.provider).toBe('@core/widgets');

    // User explicitly selects third-party provider.
    registry.setSelectedProvider(printer.id, 'temperature-graph', '@third/graph');

    const selected = registry.getEffectiveProvider(printer.id, 'temperature-graph');
    expect(selected!.contribution.provider).toBe('@third/graph');
  });

  it('returns null when no providers exist for type', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    expect(registry.getEffectiveProvider(printer.id, 'nonexistent')).toBeNull();
  });
});

// ------------------------------------------------------------------
// Per-printer page visibility
// ------------------------------------------------------------------

describe('plugin-registry / page visibility', () => {
  it('all pages are visible by default', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    registry.registerPlugin(
      createManifest({
        id: '@core/console',
        pages: [
          { id: 'console', titleKey: 'console.title', component: 'ConsolePage' },
        ],
      }),
    );

    registry.registerPlugin(
      createManifest({
        id: '@core/jobs',
        pages: [
          { id: 'jobs', titleKey: 'jobs.title', component: 'JobsPage' },
        ],
      }),
    );

    const visible = registry.getVisiblePages(printer.id);

    expect(visible).toHaveLength(2);
  });

  it('hidden pages are excluded from getVisiblePages', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    registry.registerPlugin(
      createManifest({
        id: '@core/console',
        pages: [
          { id: 'console', titleKey: 'console.title', component: 'ConsolePage' },
        ],
      }),
    );

    registry.registerPlugin(
      createManifest({
        id: '@core/jobs',
        pages: [
          { id: 'jobs', titleKey: 'jobs.title', component: 'JobsPage' },
        ],
      }),
    );

    registry.setPageVisibility(printer.id, 'jobs', false);

    const visible = registry.getVisiblePages(printer.id);

    expect(visible).toHaveLength(1);
    expect(visible[0]!.contribution.id).toBe('console');
  });

  it('page visibility is per-printer', () => {
    const { registry, settings } = setup();

    const printerA = settings.addPrinter({
      name: 'A',
      url: 'http://a.local',
    });

    const printerB = settings.addPrinter({
      name: 'B',
      url: 'http://b.local',
    });

    registry.registerPlugin(
      createManifest({
        id: '@core/console',
        pages: [
          { id: 'console', titleKey: 'console.title', component: 'ConsolePage' },
        ],
      }),
    );

    registry.setPageVisibility(printerA.id, 'console', false);

    expect(registry.isPageVisible(printerA.id, 'console')).toBe(false);
    expect(registry.isPageVisible(printerB.id, 'console')).toBe(true);
  });
});

// ------------------------------------------------------------------
// Per-printer dashboard layout
// ------------------------------------------------------------------

describe('plugin-registry / dashboard layout', () => {
  it('stores and retrieves dashboard layout per printer', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    const layout = [
      {
        instanceId: 'w1',
        type: 'temperature-graph',
        provider: '@core/widgets',
        x: 0,
        y: 0,
        w: 4,
        h: 3,
      },
    ];

    registry.setDashboardLayout(printer.id, layout);

    expect(registry.getDashboardLayout(printer.id)).toEqual(layout);
  });

  it('resets dashboard layout', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    registry.setDashboardLayout(printer.id, [
      {
        instanceId: 'w1',
        type: 'status',
        provider: '@core/widgets',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
      },
    ]);

    registry.resetDashboardLayout(printer.id);

    expect(registry.getDashboardLayout(printer.id)).toEqual([]);
  });
});

// ------------------------------------------------------------------
// Provider selection storage
// ------------------------------------------------------------------

describe('plugin-registry / provider selection', () => {
  it('stores and retrieves provider selection per printer', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    expect(registry.getSelectedProvider(printer.id, 'temperature-graph')).toBeUndefined();

    registry.setSelectedProvider(printer.id, 'temperature-graph', '@third/graph');

    expect(registry.getSelectedProvider(printer.id, 'temperature-graph')).toBe(
      '@third/graph',
    );
  });

  it('clears provider selection', () => {
    const { registry, settings } = setup();

    const printer = settings.addPrinter({
      name: 'P',
      url: 'http://p.local',
    });

    registry.setSelectedProvider(printer.id, 'camera', '@third/cam');
    registry.clearSelectedProvider(printer.id, 'camera');

    expect(registry.getSelectedProvider(printer.id, 'camera')).toBeUndefined();
  });
});