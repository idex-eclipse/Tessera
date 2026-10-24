import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../core-keeper/core-keeper';

export interface GcodeThumbnail {
  width: number;
  height: number;
  size: number;
  relative_path: string;
}

export interface GcodeFileEntry {
  filename: string;
  size: number;
  modified: number;
  slicer?: string;
  slicer_version?: string;
  layer_height?: number;
  first_layer_height?: number;
  layer_count?: number;
  object_height?: number;
  nozzle_diameter?: number;
  filament_name?: string | string[];
  filament_type?: string | string[];
  filament_total?: number;
  filament_weight_total?: number;
  estimated_time?: number;
  first_layer_extruder_temp?: number;
  first_layer_bed_temp?: number;
  chamber_temp?: number;
  print_start_time?: number | null;
  job_id?: string | null;
  thumbnails?: GcodeThumbnail[];
  raw: Record<string, any>;
}

export interface GcodeDirEntry {
  dirname: string;
  modified: number;
  size: number;
}

interface DirectoryResponse {
  dirs?: Array<{ dirname?: string; modified?: number; size?: number }>;
  files?: Array<Record<string, any>>;
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// Root = `gcodes` (фиксированный для gcode-таблицы).
// ------------------------------------------------------------------
function createGcodeFilesCore(api: PluginApi, printerId: string) {
  let path = $state('');
  let dirs = $state<GcodeDirEntry[]>([]);
  let files = $state<GcodeFileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let statuses = $state<Record<string, string>>({});
  let currentPrint = $state<{ filename: string; state: string } | null>(null);

  const unsubs: Array<() => void> = [];
  // Ответ устаревшего запроса не должен перезаписать свежий (быстрая навигация, refresh).
  let loadSeq = 0;

  // notify_filelist_changed приходит пачкой (загрузка папки, массовое удаление):
  // коалесцируем перезагрузки, чтобы не слать десятки get_directory подряд.
  const RELOAD_COALESCE_MS = 300;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFiles = false;
  let pendingHistory = false;

  function scheduleReload(what: { files?: boolean; history?: boolean }): void {
    pendingFiles ||= what.files === true;
    pendingHistory ||= what.history === true;
    if (reloadTimer) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      const files = pendingFiles;
      const history = pendingHistory;
      pendingFiles = pendingHistory = false;
      if (files) void load();
      if (history) void loadHistory();
    }, RELOAD_COALESCE_MS);
  }

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  function dirPath(): string {
    return path ? `gcodes/${path}` : 'gcodes';
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

      const res = await h.request<DirectoryResponse>('server.files.get_directory', {
        path: dirPath(),
        extended: true,
      });
      if (seq !== loadSeq) return;

      dirs = (res.dirs ?? [])
        .map((d) => ({
          dirname: d.dirname ?? '',
          modified: d.modified ?? 0,
          size: d.size ?? 0,
        }))
        .filter((d) => d.dirname !== '');

      files = (res.files ?? [])
        .filter((f) => typeof f.filename === 'string')
        .map((f) => ({
          filename: f.filename as string,
          size: typeof f.size === 'number' ? f.size : 0,
          modified: typeof f.modified === 'number' ? f.modified : 0,
          slicer: f.slicer,
          slicer_version: f.slicer_version,
          layer_height: f.layer_height,
          first_layer_height: f.first_layer_height,
          layer_count: f.layer_count,
          object_height: f.object_height,
          nozzle_diameter: f.nozzle_diameter,
          filament_name: f.filament_name,
          filament_type: f.filament_type,
          filament_total: f.filament_total,
          filament_weight: f.filament_weight,
          filament_weight_total: f.filament_weight_total,
          estimated_time: f.estimated_time,
          first_layer_extruder_temp: f.first_layer_extruder_temp,
          first_layer_bed_temp: f.first_layer_bed_temp,
          chamber_temp: f.chamber_temp,
          print_start_time:
            typeof f.print_start_time === 'number' ? f.print_start_time : null,
          thumbnails: Array.isArray(f.thumbnails) ? f.thumbnails : [],
          raw: f,
        }))
        .sort((a, b) => b.modified - a.modified);
    } catch (e) {
      if (seq !== loadSeq) return;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const h = safeHandle();
      if (!h) return;

      const res = await h.request<{ jobs?: Array<Record<string, any>> }>(
        'server.history.list',
        { limit: 200 },
      );

      const map: Record<string, string> = {};
      for (const job of res.jobs ?? []) {
        const name = job.filename;
        if (typeof name === 'string' && !(name in map)) {
          map[name] = typeof job.status === 'string' ? job.status : 'unknown';
        }
      }
      statuses = map;
    } catch {
      statuses = {};
    }
  }

  function statusOf(filename: string): string | null {
    const full = path ? `${path}/${filename}` : filename;
    if (currentPrint && currentPrint.filename === full) return currentPrint.state;
    return statuses[full] ?? null;
  }

  function navigate(p: string): void {
    path = p;
    void load();
  }

  function init(): void {
    for (const u of unsubs.splice(0)) u();

    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.onNotify('notify_filelist_changed', () => scheduleReload({ files: true })),
    );

    // Итог печати меняет статус файла (completed/cancelled/error), а список файлов — нет:
    // без этой подписки статусы устаревали до ближайшего изменения файлов.
    unsubs.push(h.onNotify('notify_history_changed', () => scheduleReload({ history: true })));

    unsubs.push(
      h.subscribe(
        { print_stats: ['state', 'filename'] },
        (delta: any) => {
          const ps = delta?.print_stats;
          if (!ps) return;
          const filename = ps.filename ?? currentPrint?.filename ?? null;
          const state = ps.state ?? currentPrint?.state ?? null;
          currentPrint = filename && state ? { filename, state } : null;
        },
        { immediate: true },
      ),
    );

    unsubs.push(
      h.onConnectionStatusChange((s) => {
        if (s === 'open') {
          void load();
          void loadHistory();
        }
      }),
    );

    if (h.readyState === 'open') {
      void load();
      void loadHistory();
    }
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
    navigate,
    refresh: load,
    statusOf,
    destroy,
  };
}

export type GcodeFilesStore = ReturnType<typeof createGcodeFilesCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<GcodeFilesStore>({
  create: (pid, api) => createGcodeFilesCore(api, pid),
  cap: 4,
});

/**
 * Хук списка gcode-файлов.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером.
 * С printerId — fleet: прямое ядро с удержанием.
 *
 * Path сохраняется при переключении принтеров (ядро в keeper).
 */
export function useGcodeFiles(
  api: PluginApi,
  printerId?: string,
): GcodeFilesStore {
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

  return createDelegateStore<GcodeFilesStore>(() => keeper.get(api.printer.id, api));
}