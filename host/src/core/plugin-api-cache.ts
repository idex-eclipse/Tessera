import type { PluginApi, PluginManifest } from '../../../plugin-sdk/src/types';

import type { AppContext } from '../app-context';
import { createPluginApi } from './plugin-api-factory';

/**
 * Единая точка получения PluginApi для всех поверхностей хоста
 * (страницы, виджеты, баннеры, оверлеи, чипы, fleet-панели, правая панель).
 *
 * Api кэшируется на (ctx, pluginId) и пересоздаётся только при смене объекта
 * манифеста (reloadRemotePlugin). Стабильная идентичность api важна: смена
 * пропа api ремонтирует Custom Element (PluginElementHost).
 *
 * Чтение идёт через ctx.loader.getLoadedPlugin — реактивно, поэтому вызов из
 * $derived/шаблона пересчитывается, когда плагин загружается/выгружается.
 */

interface CacheEntry {
  manifest: PluginManifest;
  api: PluginApi;
}

const caches = new WeakMap<AppContext, Map<string, CacheEntry>>();

function stubManifest(pluginId: string): PluginManifest {
  return { id: pluginId, name: pluginId, version: '0.0.0', entry: '' };
}

export interface GetPluginApiOptions {
  /**
   * Для плагина, который ещё не загружен, вернуть api с заглушкой манифеста
   * (страницы и виджеты рендерятся сразу, лоадер догонит). По умолчанию null.
   */
  allowUnloaded?: boolean;
}

export function getPluginApi(
  ctx: AppContext,
  pluginId: string,
  options: GetPluginApiOptions = {},
): PluginApi | null {
  const loaded = ctx.loader.getLoadedPlugin(pluginId);
  if (!loaded && !options.allowUnloaded) return null;

  let cache = caches.get(ctx);
  if (!cache) {
    cache = new Map();
    caches.set(ctx, cache);
  }

  const existing = cache.get(pluginId);
  if (loaded) {
    if (existing && existing.manifest === loaded.manifest) return existing.api;
    const api = createPluginApi(ctx, pluginId, loaded.manifest);
    cache.set(pluginId, { manifest: loaded.manifest, api });
    return api;
  }

  // Не загружен + allowUnloaded: переиспользуем заглушечный api.
  if (existing && existing.manifest.entry === '') return existing.api;
  const manifest = stubManifest(pluginId);
  const api = createPluginApi(ctx, pluginId, manifest);
  cache.set(pluginId, { manifest, api });
  return api;
}
