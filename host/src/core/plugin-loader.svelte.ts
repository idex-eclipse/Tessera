import type { PluginManifest } from '../../../plugin-sdk/src/types.ts';

import type { PluginRegistry } from './plugin-registry.svelte.ts';
import type { SettingsStore } from './settings-store.svelte.ts';

import { defineMpuElement } from '../../../plugin-sdk/src/element/define-element';
import type { Component } from 'svelte';

import type { GuardAgent } from './guard-agent';
import {
  RIGHT_PANEL_OWNER_PLUGIN_ID,
  SINGLETON_SPECS,
  SINGLETON_SURFACES,
  SURFACE_KINDS,
  SURFACE_SPECS,
  hasPersistentSurfaces,
} from './surfaces';


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
  const prepared: PluginManifest = { ...manifest };

  // Копия вкладов: нормализация и санитайз не мутируют исходный манифест.
  for (const kind of SURFACE_KINDS) {
    const list = manifest[kind];
    if (list) setManifestField(prepared, kind, list.map((c) => ({ ...c })));
  }
  for (const kind of SINGLETON_SURFACES) {
    const value = manifest[kind];
    if (value) setManifestField(prepared, kind, { ...value });
  }

  normalizeContribs(prepared, module);
  sanitizeSurfaceContributions(prepared);

  return prepared;
}

function setManifestField(manifest: PluginManifest, key: string, value: unknown): void {
  (manifest as unknown as Record<string, unknown>)[key] = value;
}

/**
 * Единый санитайз вкладов по таблицам SURFACE_SPECS / SINGLETON_SPECS:
 * невалидные вклады отбрасываются с предупреждением, не-массив → undefined.
 * Уникальные слоты дополнительно проверяются на плагин-владельца (решение L).
 */
function sanitizeSurfaceContributions(manifest: PluginManifest): void {
  for (const kind of SURFACE_KINDS) {
    const { validate, label } = SURFACE_SPECS[kind];
    if (!validate) continue;

    const list: unknown = manifest[kind];
    if (list === undefined) continue;

    if (!Array.isArray(list)) {
      setManifestField(manifest, kind, undefined);
      continue;
    }

    setManifestField(
      manifest,
      kind,
      list.filter((item) => {
        const valid = validate(item);
        if (!valid) {
          console.warn(
            `[plugin-loader] Plugin "${manifest.id}" has invalid ${label} contribution`,
            item,
          );
        }
        return valid;
      }),
    );
  }

  for (const kind of SINGLETON_SURFACES) {
    const value = manifest[kind];
    if (!value) continue;

    if (kind === 'rightPanel' && manifest.id !== RIGHT_PANEL_OWNER_PLUGIN_ID) {
      console.warn(
        `[plugin-loader] Plugin "${manifest.id}" tried to register rightPanel. ` +
          `rightPanel is only allowed for "${RIGHT_PANEL_OWNER_PLUGIN_ID}". ` +
          `Contribution rejected.`,
      );
      setManifestField(manifest, kind, undefined);
      continue;
    }

    const { validate, label } = SINGLETON_SPECS[kind];
    if (validate && !validate(value)) {
      console.warn(
        `[plugin-loader] Plugin "${manifest.id}" has invalid ${label} contribution`,
        value,
      );
      setManifestField(manifest, kind, undefined);
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

    activate(loaded);
  }

  /**
   * Единая активация загруженного плагина (core и remote): состояние лоадера,
   * реестр вкладов, гарды. Обратная операция — deactivate.
   */
  function activate(loaded: LoadedPlugin): void {
    loadedPlugins.set(loaded.manifest.id, loaded);
    registry.registerPlugin(loaded.manifest);
    registerGuardsFor(loaded.manifest, loaded.module);
  }

  function deactivate(pluginId: string): void {
    registry.unregisterPlugin(pluginId);
    guardAgent.unregisterGuards(pluginId);
    loadedPlugins.delete(pluginId);
  }

  /** fetch manifest → validate → import entry → locales → prepare. */
  async function fetchRemote(manifestUrl: string): Promise<{ loaded: LoadedPlugin; version: string }> {
    const manifest = await fetchManifest(manifestUrl);
    validateManifest(manifest, manifestUrl);

    const entryUrl = resolveEntryUrl(manifest.entry, manifestUrl);
    const module = await importModule(entryUrl);
    registerPluginLocales(module);

    const prepared = prepareManifest(manifest, module as Record<string, unknown> | null);
    return {
      loaded: { manifest: prepared, module, source: 'remote', manifestUrl },
      version: manifest.version,
    };
  }

  function registerPluginLocales(module: unknown): void {
    const locales = (module as { locales?: Record<string, unknown> } | null)?.locales;
    if (!i18n) return;
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
   * Flow: fetchRemote (fetch, validate, resolve entry relative to the manifest
   * origin, import, locales) → activate (registry + guards) → persist
   * in settings (mpu:v2:plugins).
   */
  async function installRemotePlugin(
    manifestUrl: string,
    printerIds: string[] = [],
    source: 'catalog' | 'url' = 'url',
  ): Promise<void> {
    const { loaded, version } = await fetchRemote(manifestUrl);
    activate(loaded);

    settings.addPlugin(manifestUrl, printerIds, source, version);
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

    deactivate(loaded.manifest.id);
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
        deactivate(id);
      }
    }

    const loadPromises = records
      .filter((plugin) => plugin.enabled)
      .map(async (plugin) => {
        try {
          const { loaded } = await fetchRemote(plugin.manifestUrl);
          activate(loaded);
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
      if (hasPersistentSurfaces(loaded.manifest)) {
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
    const pageUrl = typeof window !== 'undefined' ? window.location.href : undefined;
    const base = new URL(manifestUrl, pageUrl);
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