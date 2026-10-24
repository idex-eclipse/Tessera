import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../core-keeper/core-keeper';

export interface DirEntry {
  dirname: string;
  modified: number;
  size: number;
}
export interface FileEntry {
  filename: string;
  modified: number;
  size: number;
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к (printerId, root).
// Legacy-режим (без printerId) = делегат, следующий за активным принтером.
// Fleet-режим (с printerId) = прямое ядро с удержанием.
// ------------------------------------------------------------------
function createDirFilesCore(api: PluginApi, printerId: string, root: string) {
  let path = $state('');
  let dirs = $state<DirEntry[]>([]);
  let files = $state<FileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  const unsubs: Array<() => void> = [];
  // Защита от гонки: ответ устаревшего запроса не должен перезаписать свежий
  // (быстрая навигация по каталогам, refresh во время загрузки).
  let loadSeq = 0;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  function fullPath(): string {
    return path ? `${root}/${path}` : root;
  }

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    error = null;
    try {
      const h = safeHandle();
      if (!h) {
        error = 'Printer not available';
        return;
      }

      const res = await h.request<{
        dirs?: Array<Record<string, any>>;
        files?: Array<Record<string, any>>;
      }>('server.files.get_directory', { path: fullPath() });
      if (seq !== loadSeq) return;

      dirs = (res.dirs ?? [])
        .map((d) => ({
          dirname: d.dirname ?? '',
          modified: d.modified ?? 0,
          size: d.size ?? 0,
        }))
        .filter((d) => d.dirname !== '');

      files = (res.files ?? [])
        .map((f) => ({
          filename: f.filename ?? '',
          modified: f.modified ?? 0,
          size: f.size ?? 0,
        }))
        .filter((f) => f.filename !== '');
    } catch (e) {
      if (seq !== loadSeq) return;
      error = e instanceof Error ? e.message : String(e);
      dirs = [];
      files = [];
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function init(): void {
    for (const u of unsubs.splice(0)) u();

    const h = safeHandle();
    if (!h) return;

    // notify_filelist_changed приходит пачкой (загрузка папки) — коалесцируем перезагрузки
    unsubs.push(
      h.onNotify('notify_filelist_changed', () => {
        if (reloadTimer) return;
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          void load();
        }, 300);
      }),
    );
    unsubs.push(
      h.onConnectionStatusChange((s) => {
        if (s === 'open') void load();
      }),
    );

    if (h.readyState === 'open') void load();
  }

  init();

  function destroy(): void {
    for (const u of unsubs) u();
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  }

  return {
    get path() {
      return path;
    },
    get dirs() {
      return dirs;
    },
    get files() {
      return files;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    navigate(p: string): void {
      path = p;
      void load();
    },
    refresh: load,
    destroy,
  };
}

export type DirFilesStore = ReturnType<typeof createDirFilesCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-(printerId, root), переживают unmount (keep-alive).
// Ключ = `${printerId}:${root}` — один принтер может иметь несколько roots.
// ------------------------------------------------------------------
const keeper = createCoreKeeper<DirFilesStore>({
  create: (key, api) => {
    const [pid, ...rootParts] = key.split(':');
    const root = rootParts.join(':');
    return createDirFilesCore(api, pid!, root);
  },
  cap: 8,
});

/**
 * Хук списка файлов директории.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * ключ = `${api.printer.id}:${root}`. С printerId — fleet: прямое ядро.
 *
 * Path сохраняется при переключении принтеров (ядро в keeper).
 */
export function useDirFiles(
  api: PluginApi,
  root: string,
  printerId?: string,
): DirFilesStore {
  if (printerId !== undefined) {
    const key = `${printerId}:${root}`;
    const core = keeper.acquire(key, api);
    const offPrinters = api.onPrintersChange((printers) => {
      const alive = new Set(printers.map((p) => p.id));
      for (const k of Array.from(keeper.keys())) {
        const [pid] = k.split(':');
        if (pid && !alive.has(pid)) keeper.drop(k);
      }
    });
    onDestroy(() => {
      offPrinters();
      keeper.release(key);
    });
    return core;
  }

  let heldKey = `${api.printer.id}:${root}`;
  keeper.acquire(heldKey, api);

  const offPrinter = api.onPrinterChange((p) => {
    keeper.release(heldKey);
    heldKey = `${p.id}:${root}`;
    keeper.acquire(heldKey, api);
  });

  const offPrinters = api.onPrintersChange((printers) => {
    const alive = new Set(printers.map((p) => p.id));
    for (const k of Array.from(keeper.keys())) {
      const [pid] = k.split(':');
      if (pid && !alive.has(pid)) keeper.drop(k);
    }
  });

  onDestroy(() => {
    offPrinter();
    offPrinters();
    keeper.release(heldKey);
  });

  // Ключ берём из api.printer.id (реактивный геттер), а не из heldKey: иначе чтения
  // store в шаблонах не пересчитаются при смене принтера и покажут чужой список.
  return createDelegateStore<DirFilesStore>(() => keeper.get(`${api.printer.id}:${root}`, api));
}