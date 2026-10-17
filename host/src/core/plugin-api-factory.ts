import type {
  MoonrakerProxyHandle,
  PluginApi,
  PluginManifest,
  PrinterInfo,
  PluginSettingsApi
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
 * Мультипринтерный handle (api.moonrakerFor): статически привязан к printerId,
 * но ProxyInstance резолвит лениво по ТЕКУЩЕМУ url принтера.
 *
 * Свойства:
 * - переживает retry() (пересоздание прокси на том же url): следующий вызов
 *   подхватит новый instance;
 * - следует за сменой url в Settings: резолв идёт через список printers;
 * - принтер удалён: request.reject, subscribe/onNotify/poll = noop,
 *   readyState = 'closed' — БЕЗ воскрешения прокси для удалённого принтера
 *   (getMoonrakerProxy создал бы соединение заново, поэтому явный null-check);
 * - принтер с пустым url трактуется как отсутствующий (live() = null).
 *
 * Подписки, снятые до swap прокси, не переживают swap — та же семантика, что
 * у handle активного принтера: плагины переподписываются на onReady/'open'.
 *
 * GuardAgent на фазе 1 однопринтерный (target-scoped гарды — фаза 2):
 * preflight идёт в общей цепочке. Для read-only fleet-контента это не важно;
 * действия по не-активным принтерам получат атрибуцию принтера в фазе 2.
 */
function createGuardedHandleFor(
  printerId: string,
  resolvePrinter: () => { url: string } | null,
  pluginId: string,
): MoonrakerProxyHandle {
  function live(): MoonrakerProxyHandle | null {
    const printer = resolvePrinter();
    if (!printer || !printer.url) return null;
    return getMoonrakerProxy(printer.url).handle;
  }

  return {
    request<T = unknown>(method: string, params?: unknown): Promise<T> {
      const handle = live();
      if (!handle) {
        return Promise.reject(
          new Error(`[plugin-api] printer '${printerId}' is not configured`),
        );
      }
      return guardAgent
        .runPreflight(pluginId, method, params)
        .then(() => handle.request<T>(method, params));
    },

    subscribe(objects, cb, opts) {
      const handle = live();
      if (!handle) return () => {};
      return handle.subscribe(objects, cb, opts);
    },

    onNotify(event, cb) {
      const handle = live();
      if (!handle) return () => {};
      return handle.onNotify(event, cb);
    },

    poll(method, params, intervalMs) {
      const handle = live();
      if (!handle) return () => {};
      return handle.poll(method, params, intervalMs);
    },

    get httpBaseUrl() {
      return live()?.httpBaseUrl ?? '';
    },

    get readyState() {
      return live()?.readyState ?? 'closed';
    },

    get authToken() {
      return live()?.authToken ?? null;
    },

    onReady(cb) {
      const handle = live();
      if (!handle) return () => {};
      return handle.onReady(cb);
    },

    onConnectionStatusChange(cb) {
      const handle = live();
      if (!handle) {
        // принтер удалён/не настроен: сразу сообщаем 'closed'
        queueMicrotask(() => cb('closed'));
        return () => {};
      }
      return handle.onConnectionStatusChange(cb);
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

  /**
   * Кэш мультипринтерных хендлов: стабильность объекта между вызовами
   * (плагины держат handle в module-state). Размер ограничен числом принтеров,
   * виденных за сессию; хендлы удалённых принтеров инертны (live() = null)
   * и соединений не держат.
   */
  const fleetHandles = new Map<string, MoonrakerProxyHandle>();
    /** Кэш объектов settingsFor: стабильность идентичности на принтер. */
  const settingsForCache = new Map<string, PluginSettingsApi>();

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

    get printers(): PrinterInfo[] {
      return printerManager.printers.map((p) => ({
        id: p.id,
        name: p.name,
        url: p.url,
      }));
    },

    moonraker() {
      // прежнее поведение: синхронный throw без активного принтера
      if (!printerManager.activePrinter) {
        throw new Error(`[plugin-api] No active printer for moonraker()`);
      }
      return guardedHandle;
    },

    moonrakerFor(printerId: string): MoonrakerProxyHandle {
      const cached = fleetHandles.get(printerId);
      if (cached) return cached;

      const exists = printerManager.printers.some((p) => p.id === printerId);
      if (!exists) {
        throw new Error(
          `[plugin-api] moonrakerFor: unknown printerId '${printerId}'`,
        );
      }

      const handle = createGuardedHandleFor(
        printerId,
        () => printerManager.printers.find((p) => p.id === printerId) ?? null,
        pluginId,
      );
      fleetHandles.set(printerId, handle);
      return handle;
    },

    setActivePrinter(id: string | null): void {
      printerManager.setActivePrinter(id);
    },

    onPrinterChange(cb) {
      return printerManager.onPrinterChange((printer) => {
        if (printer) {
          cb(printer);
        }
      });
    },

    onPrintersChange(cb) {
      return printerManager.onPrintersChange(cb);
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

    settingsFor(printerId: string): PluginSettingsApi {
      const cached = settingsForCache.get(printerId);
      if (cached) return cached;

      const exists = printerManager.printers.some((p) => p.id === printerId);
      if (!exists) {
        throw new Error(
          `[plugin-api] settingsFor: unknown printerId '${printerId}'`,
        );
      }

      const s: PluginSettingsApi = {
        get<T>(key: string): T | undefined {
          return settings.getPluginSetting<T>(printerId, pluginId, key);
        },

        set(key: string, value: unknown): void {
          settings.setPluginSetting(printerId, pluginId, key, value);
        },

        onChange(cb) {
          return settings.onPluginSettingsChange(printerId, pluginId, () => {
            const current = settings.getPluginSettings(printerId, pluginId);
            cb('', current);
          });
        },
      };

      settingsForCache.set(printerId, s);
      return s;
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