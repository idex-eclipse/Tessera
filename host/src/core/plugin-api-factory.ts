import type {
  MoonrakerProxyHandle,
  PluginApi,
  PluginManifest,
} from '../../../plugin-sdk/src/types';

import { getMoonrakerProxy } from './moonraker-proxy';
import { guardAgent } from './guard-agent';

import type { AppContext } from '../app-context';

/**
 * Обёртка handle: request() идёт через GuardAgent с атрибуцией инициатора;
 * subscribe/onNotify/poll/геттеры делегируются без изменений (poll и subscribe
 * вне конвейера по CONTEXT). Handle резолвится лениво на каждый вызов —
 * после смены принтера обёртка указывает на новый ProxyInstance.
 */
function createGuardedHandle(
  resolveHandle: () => MoonrakerProxyHandle,
  pluginId: string,
): MoonrakerProxyHandle {
  return {
    request<T = unknown>(method: string, params?: unknown): Promise<T> {
      let handle: MoonrakerProxyHandle;
      try {
        handle = resolveHandle();
      } catch (e) {
        return Promise.reject(e);
      }
      return guardAgent
        .runPreflight(pluginId, method, params)
        .then(() => handle.request<T>(method, params));
    },

    subscribe(objects, cb, opts) {
      return resolveHandle().subscribe(objects, cb, opts);
    },

    onNotify(event, cb) {
      return resolveHandle().onNotify(event, cb);
    },

    poll(method, params, intervalMs) {
      return resolveHandle().poll(method, params, intervalMs);
    },

    get httpBaseUrl() {
      return resolveHandle().httpBaseUrl;
    },

    get readyState() {
      return resolveHandle().readyState;
    },

    get authToken() {
      return resolveHandle().authToken;
    },

    onReady(cb) {
      return resolveHandle().onReady(cb);
    },

    onConnectionStatusChange(cb) {
      return resolveHandle().onConnectionStatusChange(cb);
    },
  };
}

/**
 * Creates a PluginApi instance for a specific plugin.
 * All getters read current state dynamically (printer, theme, locale).
 */
export function createPluginApi(
  ctx: AppContext,
  pluginId: string,
  manifest: PluginManifest,
): PluginApi {
  const { printerManager, settings, i18n, ui } = ctx;

  function getPrinterInfo() {
    const printer = printerManager.activePrinter;
    if (!printer) {
      return { id: '', name: '', url: '' };
    }
    return { id: printer.id, name: printer.name, url: printer.url };
  }

  function getPrinterId(): string {
    return printerManager.activePrinterId ?? '';
  }

  function resolveHandle(): MoonrakerProxyHandle {
    const printer = printerManager.activePrinter;
    if (!printer) {
      throw new Error(`[plugin-api] No active printer for moonraker()`);
    }
    return getMoonrakerProxy(printer.url).handle;
  }

  const guardedHandle = createGuardedHandle(resolveHandle, pluginId);

  const api: PluginApi = {
    get pluginId() {
      return pluginId;
    },

    get manifest() {
      return manifest;
    },

    get printer() {
      return getPrinterInfo();
    },

    moonraker() {
      // прежнее поведение: синхронный throw без активного принтера
      if (!printerManager.activePrinter) {
        throw new Error(`[plugin-api] No active printer for moonraker()`);
      }
      return guardedHandle;
    },

    onPrinterChange(cb) {
        return printerManager.onPrinterChange((printer) => {
            if (printer) {
            cb(printer);
            }
        });
    },

    onLocaleChange(cb) {
      return i18n.onLocaleChange(cb);
    },

    onThemeChange(cb) {
      return ui.onThemeChange(cb);
    },

    settings: {
      get<T>(key: string): T | undefined {
        const printerId = getPrinterId();
        if (!printerId) return undefined;
        return settings.getPluginSetting<T>(printerId, pluginId, key);
      },

      set(key: string, value: unknown): void {
        const printerId = getPrinterId();
        if (!printerId) return;
        settings.setPluginSetting(printerId, pluginId, key, value);
      },

      onChange(cb) {
        const printerId = getPrinterId();
        if (!printerId) return () => {};
        return settings.onPluginSettingsChange(printerId, pluginId, () => {
          const current = settings.getPluginSettings(printerId, pluginId);
          cb('', current);
        });
      },
    },

    i18n: {
      t(key: string, params?: Record<string, string | number>): string {
        return i18n.t(key, params);
      },
      get locale() {
        return i18n.locale;
      },
    },

    get theme() {
      return { current: ui.theme };
    },

    guards: {
      resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void {
        guardAgent.resume(token, decision, reasonKey);
      },
    },
  };

  return api;
}