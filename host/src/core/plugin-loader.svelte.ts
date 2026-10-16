import type { PluginManifest } from '../../../plugin-sdk/src/types.ts';

import type { PluginRegistry } from './plugin-registry.svelte.ts';
import type { SettingsStore } from './settings-store.svelte.ts';

import { defineMpuElement } from '../../../plugin-sdk/src/element/define-element';
import type { Component } from 'svelte';

import type { GuardAgent } from './guard-agent';


/**
 * Modular Printer UI v2
 * Plugin Loader.
 *
 * Source of truth: CONTEXT.md
 *
 * Responsibilities:
 * - Register core plugins (static imports, in bundle)
 * - Install/uninstall remote plugins by manifest URL
 * - Resolve entry relative to manifest origin (NOT host, NOT printer)
 * - Hot install/uninstall without page reload
 * - Manage enabled/disabled state via settings store
 * - Load all enabled remote plugins on startup
 *
 * Core plugins are NOT stored in mpu:v2:plugins.
 * Only remote plugins are persisted there.
 */

const RIGHT_PANEL_OWNER_PLUGIN_ID = '@core/system';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface LoadedPlugin {
  manifest: PluginManifest;
  module: unknown;
  source: 'core' | 'remote';
  manifestUrl?: string;
}

export interface PluginLoaderDeps {
  settings: SettingsStore;
  registry: PluginRegistry;
  i18n?: I18nSink;
  guardAgent: GuardAgent;
  /**
   * Injectable for tests. Defaults to global fetch.
   */
  fetchManifest?: (url: string) => Promise<PluginManifest>;

  /**
   * Injectable for tests. Defaults to dynamic import().
   */
  importModule?: (url: string) => Promise<unknown>;
}

export interface I18nSink {
  addMessages(locale: string, messages: Record<string, unknown>): void;
}

export type PluginLoader = ReturnType<typeof createPluginLoader>;

// ------------------------------------------------------------------
// Factory
// ------------------------------------------------------------------

function autoTag(pluginId: string, kind: string): string {
  const clean = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `mpu-auto-${clean(pluginId)}-${clean(kind)}`;
}

function normalizeContribs(manifest: PluginManifest, module: Record<string, unknown> | null): void {
  for (const p of manifest.pages ?? []) {
    if (!p.element && p.component && module?.[p.component]) {
      const tag = autoTag(manifest.id, `page-${p.id}`);
      defineMpuElement(tag, module[p.component] as Component<any>);  // ← Component<any>
      p.element = tag;
    }
    if (!p.iconSvg && p.icon) {
      const raw = (module as { pageIcons?: Record<string, string> })?.pageIcons?.[p.icon];
      if (typeof raw === 'string') p.iconSvg = raw;
    }
  }
  for (const w of manifest.widgets ?? []) {
    if (!w.element && w.component && module?.[w.component]) {
      const tag = autoTag(manifest.id, `widget-${w.type}-${w.provider}`);
      defineMpuElement(tag, module[w.component] as Component<any>);  // ← Component<any>
      w.element = tag;
    }
    if (!w.headerElement && w.headerComponent && module?.[w.headerComponent]) {
      const tag = autoTag(manifest.id, `header-${w.type}-${w.provider}`);
      defineMpuElement(tag, module[w.headerComponent] as Component<any>);  // ← Component<any>
      w.headerElement = tag;
    }
  }
}

function prepareManifest(
  manifest: PluginManifest,
  module: Record<string, unknown> | null,
): PluginManifest {
  const prepared: PluginManifest = {
    ...manifest,
    pages: manifest.pages ? manifest.pages.map((p) => ({ ...p })) : undefined,
    widgets: manifest.widgets
      ? manifest.widgets.map((w) => ({ ...w }))
      : undefined,
    overlays: manifest.overlays
      ? manifest.overlays.map((o) => ({ ...o }))
      : undefined,
    banners: manifest.banners
      ? manifest.banners.map((b) => ({ ...b }))
      : undefined,
    chips: manifest.chips
      ? manifest.chips.map((c) => ({ ...c }))
      : undefined,
    printerPanels: manifest.printerPanels
      ? manifest.printerPanels.map((p) => ({ ...p }))
      : undefined,
    rightPanel: manifest.rightPanel
      ? { ...manifest.rightPanel }
      : undefined,
  };

  normalizeContribs(prepared, module);
  sanitizeSurfaceContributions(prepared);

  return prepared;
}

function sanitizeSurfaceContributions(manifest: PluginManifest): void {
  if (Array.isArray(manifest.overlays)) {
    manifest.overlays = manifest.overlays.filter((overlay) => {
      const valid = isValidSurfaceContribution(overlay);

      if (!valid) {
        console.warn(
          `[plugin-loader] Plugin "${manifest.id}" has invalid overlay contribution`,
          overlay,
        );
      }

      return valid;
    });
  } else if (manifest.overlays !== undefined) {
    manifest.overlays = undefined;
  }

  if (Array.isArray(manifest.banners)) {
    manifest.banners = manifest.banners.filter((banner) => {
      const valid = isValidSurfaceContribution(banner);

      if (!valid) {
        console.warn(
          `[plugin-loader] Plugin "${manifest.id}" has invalid banner contribution`,
          banner,
        );
      }

      return valid;
    });
  } else if (manifest.banners !== undefined) {
    manifest.banners = undefined;
  }

  if (Array.isArray(manifest.chips)) {
    manifest.chips = manifest.chips.filter((chip) => {
      const valid = isValidChipContribution(chip);

      if (!valid) {
        console.warn(
          `[plugin-loader] Plugin "${manifest.id}" has invalid chip contribution`,
          chip,
        );
      }

      return valid;
    });
  } else if (manifest.chips !== undefined) {
    manifest.chips = undefined;
  }

  if (Array.isArray(manifest.printerPanels)) {
    manifest.printerPanels = manifest.printerPanels.filter((panel) => {
      const valid = isValidPrinterPanelContribution(panel);

      if (!valid) {
        console.warn(
          `[plugin-loader] Plugin "${manifest.id}" has invalid printerPanel contribution`,
          panel,
        );
      }

      return valid;
    });
  } else if (manifest.printerPanels !== undefined) {
    manifest.printerPanels = undefined;
  }

  if (manifest.rightPanel) {
    if (manifest.id !== RIGHT_PANEL_OWNER_PLUGIN_ID) {
      console.warn(
        `[plugin-loader] Plugin "${manifest.id}" tried to register rightPanel. ` +
          `rightPanel is only allowed for "${RIGHT_PANEL_OWNER_PLUGIN_ID}". ` +
          `Contribution rejected.`,
      );

      manifest.rightPanel = undefined;
      return;
    }

    if (!isValidSurfaceContribution(manifest.rightPanel)) {
      console.warn(
        `[plugin-loader] Plugin "${manifest.id}" has invalid rightPanel contribution`,
        manifest.rightPanel,
      );

      manifest.rightPanel = undefined;
    }
  }
}

export function createPluginLoader(deps: PluginLoaderDeps) {
  const { settings, registry, i18n, guardAgent } = deps;

  const fetchManifest = deps.fetchManifest ?? defaultFetchManifest;
  const importModule = deps.importModule ?? defaultImportModule;

  /**
   * Internal state: all loaded plugins (core + remote).
   * Key: plugin id (manifest.id)
   */
  let loadedPlugins = $state<Map<string, LoadedPlugin>>(new Map());

  // ------------------------------------------------------------------
  // Core plugin registration
  // ------------------------------------------------------------------

  /**
   * Registers a core plugin. Core plugins are statically bundled.
   * They are NOT stored in mpu:v2:plugins.
   * They are always enabled.
   */
  function registerCorePlugin(
    manifest: PluginManifest,
    module: unknown,
  ): void {
    const prepared = prepareManifest(
      manifest,
      module as Record<string, unknown> | null,
    );

    const loaded: LoadedPlugin = {
      manifest: prepared,
      module,
      source: 'core',
    };

    loadedPlugins.set(prepared.id, loaded);
    registry.registerPlugin(prepared);
    registerGuardsFor(prepared, module);
  }

  function registerPluginLocales(module: unknown): void {
    if (!i18n) return;

    const locales = (module as { locales?: Record<string, Record<string, unknown>> } | null)?.locales;
    if (!locales || typeof locales !== 'object') return;

    for (const [locale, messages] of Object.entries(locales)) {
      if (messages && typeof messages === 'object') {
        i18n.addMessages(locale, messages as Record<string, unknown>);
      }
    }
  }

  /** Гарды принимаются от всех плагинов (в отличие от rightPanel, решение L). */
  function registerGuardsFor(manifest: PluginManifest, module: unknown): void {
    if (!manifest.guards || manifest.guards.length === 0) return;
    guardAgent.registerGuards(
      manifest.id,
      manifest.guards,
      module as Record<string, unknown> | null,
    );
  }

  // ------------------------------------------------------------------
  // Remote plugin management
  // ------------------------------------------------------------------

  /**
   * Installs a remote plugin by manifest URL.
   *
   * Flow:
   * 1. Fetch manifest from URL
   * 2. Validate manifest
   * 3. Resolve entry relative to manifest origin
   * 4. Dynamic import the entry
   * 5. Register in registry
   * 6. Save to settings (mpu:v2:plugins)
   */
  async function installRemotePlugin(
    manifestUrl: string,
    printerIds: string[] = [],
    source: 'catalog' | 'url' = 'url',
  ): Promise<void> {
    const manifest = await fetchManifest(manifestUrl);
    validateManifest(manifest, manifestUrl);

    const entryUrl = resolveEntryUrl(manifest.entry, manifestUrl);
    const module = await importModule(entryUrl);
    registerPluginLocales(module);
    const prepared = prepareManifest(
      manifest,
      module as Record<string, unknown> | null,
    );

    const loaded: LoadedPlugin = {
      manifest: prepared,
      module,
      source: 'remote',
      manifestUrl,
    };

    loadedPlugins.set(prepared.id, loaded);
    registry.registerPlugin(prepared);

    settings.addPlugin(manifestUrl, printerIds, source, manifest.version);
  }

  /**
   * Uninstalls a remote plugin.
   * Removes from registry, loaded state, and settings.
   */
  function uninstallRemotePlugin(manifestUrl: string): void {
    const loaded = findByManifestUrl(manifestUrl);

    if (!loaded) {
      return;
    }

    registry.unregisterPlugin(loaded.manifest.id);
    guardAgent.unregisterGuards(loaded.manifest.id);   
    loadedPlugins.delete(loaded.manifest.id);
    settings.removePlugin(manifestUrl);
  }

  /**
   * Enables or disables a remote plugin.
   * When disabled, contributions are removed from registry.
   * When enabled, contributions are re-registered.
   */
  function setPluginEnabled(manifestUrl: string, enabled: boolean): void {
    const loaded = findByManifestUrl(manifestUrl);

    if (!loaded) {
      return;
    }

    settings.setPluginEnabled(manifestUrl, enabled);

    if (enabled) {
      registry.registerPlugin(loaded.manifest);
      registerGuardsFor(loaded.manifest, loaded.module); 
    } else {
      guardAgent.unregisterGuards(loaded.manifest.id); 
      registry.unregisterPlugin(loaded.manifest.id);
    }
  }

  /**
   * Reloads a remote plugin: uninstall + install.
   * Useful for hot-reload during development.
   */
  async function reloadRemotePlugin(manifestUrl: string): Promise<void> {
    const record = settings.plugins.find(
      (plugin) => plugin.manifestUrl === manifestUrl,
    );

    const wasEnabled = record?.enabled ?? true;
    const printerIds = record?.printerIds ?? [];
    const source = record?.source ?? 'url';

    uninstallRemotePlugin(manifestUrl);
    await installRemotePlugin(manifestUrl, printerIds, source);

    if (!wasEnabled) {
      setPluginEnabled(manifestUrl, false);
    }
  }

  // ------------------------------------------------------------------
  // Startup: load all enabled remote plugins
  // ------------------------------------------------------------------

  /**
   * Loads all enabled remote plugins from settings.
   * Called once during app initialization.
   * Failures are logged but do not block other plugins.
   */
  async function loadEnabledPlugins(): Promise<void> {
    const records = settings.plugins;

    const enabledUrls = new Set(
      records
        .filter((plugin) => plugin.enabled)
        .map((plugin) => plugin.manifestUrl),
    );

    // Выгружаем remote-плагины, которых больше нет среди enabled.
    for (const [id, loaded] of [...loadedPlugins]) {
      if (
        loaded.source === 'remote' &&
        loaded.manifestUrl &&
        !enabledUrls.has(loaded.manifestUrl)
      ) {
        registry.unregisterPlugin(id);
        guardAgent.unregisterGuards(id);   
        loadedPlugins.delete(id);
      }
    }

    const loadPromises = records
      .filter((plugin) => plugin.enabled)
      .map(async (plugin) => {
        try {
          const manifest = await fetchManifest(plugin.manifestUrl);
          validateManifest(manifest, plugin.manifestUrl);

          const entryUrl = resolveEntryUrl(manifest.entry, plugin.manifestUrl);
          const module = await importModule(entryUrl);
          registerPluginLocales(module);
          const prepared = prepareManifest(
            manifest,
            module as Record<string, unknown> | null,
          );

          const loaded: LoadedPlugin = {
            manifest: prepared,
            module,
            source: 'remote',
            manifestUrl: plugin.manifestUrl,
          };

          loadedPlugins.set(prepared.id, loaded);
          registry.registerPlugin(prepared);
          registerGuardsFor(prepared, module);
        } catch (error) {
          console.error(
            `[plugin-loader] Failed to load plugin from ${plugin.manifestUrl}:`,
            error,
          );
        }
      });

    await Promise.allSettled(loadPromises);
  }

  function pluginAppliesToPrinter(pluginId: string, printerId: string): boolean {
    const loaded = loadedPlugins.get(pluginId);

    if (!loaded) {
      return false;
    }

    if (loaded.source === 'core') {
      return true;
    }

    const record = settings.plugins.find(
      (plugin) => plugin.manifestUrl === loaded.manifestUrl,
    );

    if (!record) {
      return true;
    }

    const scope = record.printerIds ?? [];
    return scope.length === 0 || scope.includes(printerId);
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  function getLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
    return loadedPlugins.get(pluginId);
  }

  function getModule(pluginId: string): unknown | undefined {
    return loadedPlugins.get(pluginId)?.module;
  }

  function getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(loadedPlugins.values());
  }

  function isLoaded(pluginId: string): boolean {
    return loadedPlugins.has(pluginId);
  }

    // ------------------------------------------------------------------
  // Surface-активация
  // ------------------------------------------------------------------

  /**
   * Гарантирует, что все плагины с постоянными поверхностями (overlays /
   * banners / rightPanel) активированы. Вызывается один раз при старте
   * приложения (main.ts) — после всех registerCorePlugin и loadEnabledPlugins.
   *
   * Для core-плагинов модуль уже статически импортирован; для remote —
   * уже загружен в loadEnabledPlugins/installRemotePlugin. Функция
   * является точкой расширения: если в будущем появится ленивая оценка
   * модулей, здесь можно добавить принудительный import(entry).
   *
   * Также выводит в консоль список surface-плагинов — удобно для отладки
   * («какие оверлеи должны быть смонтированы на старте»).
   */
  function eagerActivateSurfacePlugins(): void {
    const surfaceIds: string[] = [];

    for (const loaded of loadedPlugins.values()) {
      if (hasSurfaces(loaded.manifest)) {
        surfaceIds.push(loaded.manifest.id);
      }
    }

    /** if (surfaceIds.length > 0) {
      console.info(
        `[plugin-loader] Eager-activated surface plugins: ${surfaceIds.join(', ')}`,
      );
    } */
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  function findByManifestUrl(manifestUrl: string): LoadedPlugin | undefined {
    for (const loaded of loadedPlugins.values()) {
      if (loaded.manifestUrl === manifestUrl) {
        return loaded;
      }
    }
    return undefined;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    // Core
    registerCorePlugin,

    // Remote
    installRemotePlugin,
    uninstallRemotePlugin,
    setPluginEnabled,
    reloadRemotePlugin,
    pluginAppliesToPrinter,

    // Startup
    loadEnabledPlugins,
    eagerActivateSurfacePlugins,

    // Queries
    getLoadedPlugin,
    getModule,
    getLoadedPlugins,
    isLoaded,
  };
}

// ------------------------------------------------------------------
// Module-level helpers
// ------------------------------------------------------------------

function validateManifest(manifest: PluginManifest, sourceUrl: string): void {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`[plugin-loader] Invalid manifest from ${sourceUrl}: not an object`);
  }

  if (!manifest.id || typeof manifest.id !== 'string') {
    throw new Error(`[plugin-loader] Invalid manifest from ${sourceUrl}: missing or invalid "id"`);
  }

  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error(`[plugin-loader] Invalid manifest from ${sourceUrl}: missing or invalid "name"`);
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error(`[plugin-loader] Invalid manifest from ${sourceUrl}: missing or invalid "version"`);
  }

  if (!manifest.entry || typeof manifest.entry !== 'string') {
    throw new Error(`[plugin-loader] Invalid manifest from ${sourceUrl}: missing or invalid "entry"`);
  }
}

interface SurfaceContributionLike {
  id?: unknown;
  element?: unknown;
}

function isValidSurfaceContribution(
  value: unknown,
): value is { id: string; element: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as SurfaceContributionLike;

  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.element === 'string' &&
    candidate.element.length > 0
  );
}

interface ChipContributionLike {
  type?: unknown;
  provider?: unknown;
  titleKey?: unknown;
  element?: unknown;
  pickerElement?: unknown;
}

function isValidChipContribution(
  value: unknown,
): value is ChipContributionLike {
  if (!value || typeof value !== 'object') return false;
  const c = value as ChipContributionLike;
  return (
    typeof c.type === 'string' && c.type.length > 0 &&
    typeof c.provider === 'string' && c.provider.length > 0 &&
    typeof c.titleKey === 'string' && c.titleKey.length > 0 &&
    typeof c.element === 'string' && c.element.length > 0 &&
    typeof c.pickerElement === 'string' && c.pickerElement.length > 0
  );
}

interface PrinterPanelContributionLike {
  id?: unknown;
  element?: unknown;
  titleKey?: unknown;
}

function isValidPrinterPanelContribution(
  value: unknown,
): value is PrinterPanelContributionLike {
  if (!value || typeof value !== 'object') return false;
  const p = value as PrinterPanelContributionLike;
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.element === 'string' && p.element.length > 0
  );
}

/**
 * Плагин имеет постоянные поверхности (overlays / banners / rightPanel).
 * Такие плагины должны быть активированы eagerly на старте,
 * чтобы оверлеи/баннеры работали без посещения страницы плагина.
 */
function hasSurfaces(manifest: PluginManifest): boolean {
  return Boolean(
    (manifest.overlays && manifest.overlays.length > 0) ||
      (manifest.banners && manifest.banners.length > 0) ||
      (manifest.chips && manifest.chips.length > 0) ||
      (manifest.printerPanels && manifest.printerPanels.length > 0) ||
      manifest.rightPanel,
  );
}

/**
 * Resolves entry URL relative to the manifest's origin.
 *
 * From CONTEXT.md:
 * "entry резолвится относительно origin МАНИФЕСТА (не хоста, не принтера)"
 */
function resolveEntryUrl(entry: string, manifestUrl: string): string {
  try {
    // manifestUrl может прийти относительным (same-origin каталог) —
    // достраиваем base от origin хоста, иначе new URL(entry, base) бросает
    const base = new URL(manifestUrl, window.location.href);
    return new URL(entry, base).href;
  } catch {
    throw new Error(
      `[plugin-loader] Cannot resolve entry "${entry}" relative to "${manifestUrl}"`,
    );
  }
}

async function defaultFetchManifest(url: string): Promise<PluginManifest> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `[plugin-loader] Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<PluginManifest>;
}

async function defaultImportModule(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}