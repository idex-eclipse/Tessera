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

export interface PrinterConnectionState {
  printerId: string;
  url: string;
  status: ConnectionStatus;
  lastSuccessfulAt: number | null;
}

export interface PrinterManagerOptions {
  getProxy?: (
    printerUrl: string,
    deps?: MoonrakerProxyDeps,
  ) => MoonrakerProxy;
  proxyDeps?: MoonrakerProxyDeps;
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

  // Manual state (не $state - нет effect контекста на module-level)
  let connectionStates: Record<string, PrinterConnectionState> = {};
  
  // Event emitter для connection state changes
  const connectionStateListeners = new Set<
    (states: Record<string, PrinterConnectionState>) => void
  >();

  function notifyConnectionStateChange(): void {
    const snapshot = { ...connectionStates };
    for (const listener of Array.from(connectionStateListeners)) {
      safeCall(listener, snapshot);
    }
  }

  const printerProxyKey = new Map<string, string>();
  const proxyByKey = new Map<string, MoonrakerProxy>();
  const urlRefs = new Map<string, number>();
  const listenerUnsubs = new Map<string, Array<() => void>>();

  const printerChangeListeners = new Set<
    (printer: PrinterInfo | null) => void
  >();

  const printersChangeListeners = new Set<
    (printers: PrinterInfo[]) => void
  >();

  for (const printer of settings.printers) {
    attachPrinter(printer);
  }

  function addPrinter(input: { name: string; url: string }): PrinterRecord {
    const previousActivePrinterId = settings.activePrinterId;
    const record = settings.addPrinter(input);
    attachPrinter(record);
    maybeNotifyActivePrinterChange(previousActivePrinterId);
    notifyPrintersChange();
    return record;
  }

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

  function dispose(): void {
    for (const printerId of Array.from(printerProxyKey.keys())) {
      detachPrinter(printerId);
    }
    printerChangeListeners.clear();
    printersChangeListeners.clear();
    connectionStateListeners.clear();
  }

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
      ? { id: active.id, name: active.name, url: active.url }
      : null;

    for (const listener of Array.from(printerChangeListeners)) {
      safeCall(listener, info);
    }
  }

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

  function onConnectionStateChange(
    callback: (states: Record<string, PrinterConnectionState>) => void,
  ): () => void {
    connectionStateListeners.add(callback);
    callback({ ...connectionStates }); // Initial call
    return () => {
      connectionStateListeners.delete(callback);
    };
  }

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
      notifyConnectionStateChange();
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
      notifyConnectionStateChange();
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
          // Ignore
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
          // Ignore
        }
      } else {
        urlRefs.set(key, refs);
      }
    }

    removeConnectionState(printerId);
  }

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
    notifyConnectionStateChange();
  }

  function removeConnectionState(printerId: string): void {
    if (!(printerId in connectionStates)) {
      return;
    }

    const next = { ...connectionStates };
    delete next[printerId];
    connectionStates = next;
    notifyConnectionStateChange();
  }

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
    onConnectionStateChange,
  };
}

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