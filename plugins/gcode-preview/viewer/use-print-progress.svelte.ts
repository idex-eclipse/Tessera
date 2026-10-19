import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../../shared/core-keeper/core-keeper';

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// Legacy-режим (без printerId) = делегат, следующий за активным принтером.
// Fleet-режим (с printerId) = прямое ядро с удержанием.
// ------------------------------------------------------------------
function createPrintProgressCore(api: PluginApi, printerId: string | null) {
  const fleet = printerId !== null;

  let filename = $state('');
  let filePosition = $state(0);
  let printing = $state(false);

  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return fleet ? api.moonrakerFor(printerId as string) : api.moonraker();
    } catch {
      return null;
    }
  }

  function init(): void {
    for (const u of unsubs.splice(0)) u();

    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.subscribe(
        { print_stats: ['filename', 'state'], virtual_sdcard: ['file_position'] },
        (d: any) => {
          const ps = d?.print_stats;
          if (ps) {
            if (typeof ps.filename === 'string') filename = ps.filename;
            if (typeof ps.state === 'string') {
              printing = ps.state === 'printing' || ps.state === 'paused';
            }
          }
          const vs = d?.virtual_sdcard;
          if (vs && typeof vs.file_position === 'number') filePosition = vs.file_position;
        },
        { immediate: true },
      ),
    );
  }

  init();

  let offPrinter: () => void = () => {};

  if (!fleet) {
    offPrinter = api.onPrinterChange(() => {
      filename = '';
      filePosition = 0;
      printing = false;
      init();
    });
  }

  function destroy(): void {
    offPrinter();
    for (const u of unsubs) u();
  }

  return {
    get filename() {
      return filename;
    },
    get filePosition() {
      return filePosition;
    },
    get printing() {
      return printing;
    },
    destroy,
  };
}

export type PrintProgressStore = ReturnType<typeof createPrintProgressCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<PrintProgressStore>({
  create: (pid, api) => createPrintProgressCore(api, pid),
  cap: 4,
});

/**
 * Хук прогресса печати (filename/filePosition/printing).
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * refcount на текущего принтера, ядра других принтеров живут в keeper по
 * политике keep-alive. С printerId — fleet: прямое ядро с удержанием.
 */
export function usePrintProgress(
  api: PluginApi,
  printerId?: string,
): PrintProgressStore {
  if (printerId !== undefined) {
    const core = keeper.acquire(printerId, api);
    const offPrinters = api.onPrintersChange((printers) => {
      keeper.prune(printers.map((p) => p.id));
    });
    onDestroy(() => {
      offPrinters();
      keeper.release(printerId);
    });
    return core;
  }

  let heldPid = api.printer.id;
  keeper.acquire(heldPid, api);

  const offPrinter = api.onPrinterChange((p) => {
    keeper.release(heldPid);
    heldPid = p.id;
    keeper.acquire(heldPid, api);
  });

  const offPrinters = api.onPrintersChange((printers) => {
    keeper.prune(printers.map((p) => p.id));
  });

  onDestroy(() => {
    offPrinter();
    offPrinters();
    keeper.release(heldPid);
  });

  return createDelegateStore<PrintProgressStore>(() => keeper.get(api.printer.id, api));
}