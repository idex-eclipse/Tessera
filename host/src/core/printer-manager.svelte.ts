import type {
  ConnectionStatus,
  PrinterInfo,
} from '../../../plugin-sdk/src/types';

import {
  getMoonrakerProxy,
  type MoonrakerProxy,
  type MoonrakerProxyDeps,
} from './moonraker-proxy';

import type {
  PrinterRecord,
  SettingsStore,
} from './settings-store.svelte.ts';

import { bindProxyToAuth } from './auth-store.svelte';

/**
 * Modular Printer UI v2
 * Printer manager.
 *
 * Source of truth: CONTEXT.md
 *
 * Rules:
 * - Host is a dumb UI orchestrator.
 * - Host MUST NOT read business data from Moonraker.
 * - Host MAY read infrastructure connection status.
 * - Switching printer tabs MUST NOT destroy other printer connections.
 */

export interface PrinterConnectionState {
  printerId: string;
  url: string;
  status: ConnectionStatus;
  lastSuccessfulAt: number | null;
}

export interface PrinterManagerOptions {
  /**
   * Injectable proxy accessor.
   * Defaults to shared MoonrakerProxy pool.
   */
  getProxy?: (
    printerUrl: string,
    deps?: MoonrakerProxyDeps,
  ) => MoonrakerProxy;

  /**
   * Optional deps passed to proxy factory.
   */
  proxyDeps?: MoonrakerProxyDeps;

  /**
   * Clock injection for deterministic tests.
   */
  now?: () => number;
}

export type PrinterManager = ReturnType<typeof createPrinterManager>;

export function createPrinterManager(
  settings: SettingsStore,
  options: PrinterManagerOptions = {},
) {
  const getProxy = options.getProxy ?? getMoonrakerProxy;
  const proxyDeps = options.proxyDeps;
  const now = options.now ?? (() => Date.now());

  /**
   * Infrastructure-only connection states per printer id.
   */
  let connectionStates = $state<Record<string, PrinterConnectionState>>({});

  /**
   * printerId -> normalized proxy key.
   */
  const printerProxyKey = new Map<string, string>();

  /**
   * normalized proxy key -> proxy instance.
   */
  const proxyByKey = new Map<string, MoonrakerProxy>();

  /**
   * normalized proxy key -> number of printer records using it.
   */
  const urlRefs = new Map<string, number>();

  /**
   * printerId -> proxy listener unsubscribers.
   */
  const listenerUnsubs = new Map<string, Array<() => void>>();

  /**
   * Active printer change listeners.
   * Later used by PluginApi.onPrinterChange.
   */
  const printerChangeListeners = new Set<
    (printer: PrinterInfo | null) => void
  >();

  /**
   * Printers list change listeners (add/update/remove/import).
   * Later used by PluginApi.onPrintersChange.
   */
  const printersChangeListeners = new Set<
    (printers: PrinterInfo[]) => void
  >();

  /**
   * Attach proxies for printers already present in settings.
   */
  for (const printer of settings.printers) {
    attachPrinter(printer);
  }

  // ------------------------------------------------------------------
  // Public CRUD wrappers
  // ------------------------------------------------------------------

  function addPrinter(input: { name: string; url: string }): PrinterRecord {
    const previousActivePrinterId = settings.activePrinterId;

    const record = settings.addPrinter(input);

    attachPrinter(record);
    maybeNotifyActivePrinterChange(previousActivePrinterId);
    notifyPrintersChange();

    return record;
  }

  /**
   * Rename printer and/or move it to a new URL.
   * On URL change the old ProxyInstance is detached and a new one attached,
   * so the connection badge follows immediately.
   */
  function updatePrinter(
    id: string,
    patch: { name?: string; url?: string },
  ): void {
    const old = settings.printers.find((p) => p.id === id);
    if (!old) return;

    const nextUrl = (patch.url ?? old.url).trim();
    const nextName = (patch.name ?? old.name).trim();
    if (!nextUrl || !nextName) return;

    const urlChanged = nextUrl !== old.url;

    if (urlChanged) {
      detachPrinter(old.id);
    }

    settings.updatePrinter(id, { name: nextName, url: nextUrl });

    const updated = settings.printers.find((p) => p.id === id);
    if (updated && urlChanged) {
      attachPrinter(updated);

      // Активный принтер сменил URL — заставляем виджеты переподписаться
      if (id === settings.activePrinterId) {
        maybeNotifyActivePrinterChange(null);
      }
    }

    notifyPrintersChange();
  }

  function removePrinter(id: string): void {
    const previousActivePrinterId = settings.activePrinterId;

    detachPrinter(id);
    settings.removePrinter(id);

    maybeNotifyActivePrinterChange(previousActivePrinterId);
    notifyPrintersChange();
  }

  function setActivePrinter(id: string | null): void {
    const previousActivePrinterId = settings.activePrinterId;

    if (id !== null) {
      const printer = settings.printers.find((item) => item.id === id);

      if (printer && !printerProxyKey.has(printer.id)) {
        attachPrinter(printer);
      }
    }

    settings.setActivePrinter(id);
    maybeNotifyActivePrinterChange(previousActivePrinterId);
  }

  /**
   * Manual synchronization after direct settings mutations,
   * e.g. settings JSON import.
   */
  function syncFromSettings(): void {
    const previousActivePrinterId = settings.activePrinterId;

    const currentIds = new Set(settings.printers.map((printer) => printer.id));

    for (const printerId of Array.from(printerProxyKey.keys())) {
      if (!currentIds.has(printerId)) {
        detachPrinter(printerId);
      }
    }

    for (const printer of settings.printers) {
      const key = printerProxyKey.get(printer.id);
      const proxy = key ? proxyByKey.get(key) : undefined;
      const state = connectionStates[printer.id];

      const needsAttach =
        !key ||
        !proxy ||
        proxy.disposed ||
        !state ||
        state.url !== printer.url;

      if (needsAttach) {
        detachPrinter(printer.id);
        attachPrinter(printer);
      }
    }

    maybeNotifyActivePrinterChange(previousActivePrinterId);
    notifyPrintersChange();
  }

  /**
   * Retry connection for a printer.
   * If printerId is omitted, retries active printer.
   */
  function retry(printerId?: string): void {
    const target = printerId
      ? settings.printers.find((printer) => printer.id === printerId)
      : settings.activePrinter;

    if (!target || !target.url) {
      return;
    }

    const key = printerProxyKey.get(target.id);

    if (!key) {
      attachPrinter(target);
      return;
    }

    /**
     * If several printer records share the same URL,
     * retry recreates the shared proxy for all of them.
     */
    const affectedPrinterIds = settings.printers
      .filter((printer) => printerProxyKey.get(printer.id) === key)
      .map((printer) => printer.id);

    for (const id of affectedPrinterIds) {
      detachPrinter(id);
    }

    for (const id of affectedPrinterIds) {
      const printer = settings.printers.find((item) => item.id === id);

      if (printer) {
        attachPrinter(printer);
      }
    }
  }

  /**
   * Dispose manager and release all proxies owned by it.
   */
  function dispose(): void {
    for (const printerId of Array.from(printerProxyKey.keys())) {
      detachPrinter(printerId);
    }

    printerChangeListeners.clear();
    printersChangeListeners.clear();
  }

  // ------------------------------------------------------------------
  // Active printer change subscription
  // ------------------------------------------------------------------

  function onPrinterChange(
    callback: (printer: PrinterInfo | null) => void,
  ): () => void {
    printerChangeListeners.add(callback);

    return () => {
      printerChangeListeners.delete(callback);
    };
  }

  function maybeNotifyActivePrinterChange(
    previousActivePrinterId: string | null,
  ): void {
    if (settings.activePrinterId === previousActivePrinterId) {
      return;
    }

    notifyActivePrinterChange();
  }

  function notifyActivePrinterChange(): void {
    const active = settings.activePrinter;

    const info: PrinterInfo | null = active
      ? {
          id: active.id,
          name: active.name,
          url: active.url,
        }
      : null;

    for (const listener of Array.from(printerChangeListeners)) {
      safeCall(listener, info);
    }
  }

  // ------------------------------------------------------------------
  // Printers list change subscription
  // ------------------------------------------------------------------

  function onPrintersChange(
    callback: (printers: PrinterInfo[]) => void,
  ): () => void {
    printersChangeListeners.add(callback);

    return () => {
      printersChangeListeners.delete(callback);
    };
  }

  function notifyPrintersChange(): void {
    const printers: PrinterInfo[] = settings.printers.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
    }));

    for (const listener of Array.from(printersChangeListeners)) {
      safeCall(listener, printers);
    }
  }

  // ------------------------------------------------------------------
  // Proxy attach/detach internals
  // ------------------------------------------------------------------

  function attachPrinter(printer: PrinterRecord): void {
    const existingKey = printerProxyKey.get(printer.id);

    if (existingKey) {
      const existingProxy = proxyByKey.get(existingKey);
      const existingState = connectionStates[printer.id];

      if (
        existingProxy &&
        !existingProxy.disposed &&
        existingState &&
        existingState.url === printer.url
      ) {
        return;
      }

      detachPrinter(printer.id);
    }

    if (!printer.url) {
      connectionStates = {
        ...connectionStates,
        [printer.id]: {
          printerId: printer.id,
          url: '',
          status: 'closed',
          lastSuccessfulAt: null,
        },
      };

      return;
    }

    let proxy: MoonrakerProxy;

    try {
      proxy = getProxy(printer.url, proxyDeps);
    } catch {
      connectionStates = {
        ...connectionStates,
        [printer.id]: {
          printerId: printer.id,
          url: printer.url,
          status: 'closed',
          lastSuccessfulAt: null,
        },
      };

      return;
    }

    bindProxyToAuth(printer.id, proxy);
    const key = proxy.printerUrl;

    proxyByKey.set(key, proxy);
    printerProxyKey.set(printer.id, key);
    urlRefs.set(key, (urlRefs.get(key) ?? 0) + 1);

    const unsubscribeStatus = proxy.handle.onConnectionStatusChange(
      (status) => {
        updateConnectionState(printer.id, printer.url, status);
      },
    );

    listenerUnsubs.set(printer.id, [unsubscribeStatus]);

    updateConnectionState(printer.id, printer.url, proxy.handle.readyState);
  }

  function detachPrinter(printerId: string): void {
    const unsubs = listenerUnsubs.get(printerId);

    if (unsubs) {
      for (const unsubscribe of unsubs) {
        try {
          unsubscribe();
        } catch {
          // Ignore listener unsubscribe errors.
        }
      }

      listenerUnsubs.delete(printerId);
    }

    const key = printerProxyKey.get(printerId);
    printerProxyKey.delete(printerId);

    if (key) {
      const refs = (urlRefs.get(key) ?? 1) - 1;

      if (refs <= 0) {
        urlRefs.delete(key);

        const proxy = proxyByKey.get(key);
        proxyByKey.delete(key);

        try {
          proxy?.dispose();
        } catch {
          // Ignore dispose errors.
        }
      } else {
        urlRefs.set(key, refs);
      }
    }

    removeConnectionState(printerId);
  }

  // ------------------------------------------------------------------
  // Connection state internals
  // ------------------------------------------------------------------

  function updateConnectionState(
    printerId: string,
    url: string,
    status: ConnectionStatus,
  ): void {
    if (!printerProxyKey.has(printerId)) {
      return;
    }

    const previous = connectionStates[printerId];

    const lastSuccessfulAt =
      status === 'open' ? now() : (previous?.lastSuccessfulAt ?? null);

    connectionStates = {
      ...connectionStates,
      [printerId]: {
        printerId,
        url,
        status,
        lastSuccessfulAt,
      },
    };
  }

  function removeConnectionState(printerId: string): void {
    if (!(printerId in connectionStates)) {
      return;
    }

    const next = { ...connectionStates };
    delete next[printerId];

    connectionStates = next;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    get printers(): PrinterRecord[] {
      return settings.printers;
    },

    get activePrinterId(): string | null {
      return settings.activePrinterId;
    },

    get activePrinter(): PrinterRecord | null {
      return settings.activePrinter;
    },

    get connections(): Record<string, PrinterConnectionState> {
      return connectionStates;
    },

    getConnection(printerId: string): PrinterConnectionState | null {
      return connectionStates[printerId] ?? null;
    },

    get activeConnection(): PrinterConnectionState | null {
      const activePrinterId = settings.activePrinterId;

      if (!activePrinterId) {
        return null;
      }

      return connectionStates[activePrinterId] ?? null;
    },

    get isActivePrinterOffline(): boolean {
      return this.activeConnection?.status === 'closed';
    },

    get shouldShowOfflineOverlay(): boolean {
      if (!settings.activePrinterId) {
        return false;
      }

      /**
       * Overlay is shown when active printer is offline.
       * Connecting state is displayed as badge/status, not as hard overlay.
       */
      let status = this.activeConnection?.status;
      return status === 'closed' || status === 'connecting';
    },

    addPrinter,
    updatePrinter,
    removePrinter,
    setActivePrinter,

    syncFromSettings,
    retry,
    dispose,

    onPrinterChange,
    onPrintersChange,
  };
}

// --------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------

function safeCall<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): void {
  try {
    fn(...args);
  } catch (error) {
    console.error('[printer-manager] listener error', error);
  }
}