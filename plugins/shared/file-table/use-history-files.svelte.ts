import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../core-keeper/core-keeper';

import type { GcodeFileEntry } from './use-gcode-files.svelte.ts';

interface HistoryListResponse {
  jobs?: Array<Record<string, any>>;
  count?: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function numOpt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// История плоская (без path).
// ------------------------------------------------------------------
function createHistoryFilesCore(api: PluginApi, printerId: string) {
  let files = $state<GcodeFileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let statuses = $state<Record<string, string>>({});
  let currentPrint = $state<{ filename: string; state: string } | null>(null);

  const unsubs: Array<() => void> = [];
  // Ответ устаревшего запроса не должен перезаписать свежий (notify + refresh подряд).
  let loadSeq = 0;

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
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

      const res = await h.request<HistoryListResponse>('server.history.list', {
        limit: 0,
        order: 'desc',
      });
      if (seq !== loadSeq) return;

      files = (res.jobs ?? [])
        .filter((j) => typeof j.filename === 'string')
        .map((j) => {
          const meta =
            typeof j.metadata === 'object' && j.metadata !== null
              ? (j.metadata as Record<string, any>)
              : {};
          return {
            filename: j.filename as string,
            size: num(meta.size),
            modified: num(meta.modified) || num(j.start_time),
            slicer: meta.slicer,
            slicer_version: meta.slicer_version,
            layer_height: meta.layer_height,
            first_layer_height: meta.first_layer_height,
            layer_count: meta.layer_count,
            object_height: meta.object_height,
            nozzle_diameter: meta.nozzle_diameter,
            filament_name: meta.filament_name,
            filament_type: meta.filament_type,
            filament_total: numOpt(j.filament_used) ?? numOpt(meta.filament_total),
            filament_weight_total: meta.filament_weight_total,
            estimated_time: numOpt(meta.estimated_time) ?? numOpt(j.estimate),
            first_layer_extruder_temp: meta.first_layer_extruder_temp,
            first_layer_bed_temp: meta.first_layer_bed_temp,
            chamber_temp: meta.chamber_temp,
            print_start_time: numOpt(j.start_time) ?? null,
            job_id: typeof j.job_id === 'string' ? j.job_id : null,
            thumbnails: Array.isArray(meta.thumbnails) ? meta.thumbnails : [],
            raw: { ...meta, ...j },
          };
        });

      const map: Record<string, string> = {};
      for (const job of res.jobs ?? []) {
        const name = job.filename;
        if (typeof name === 'string' && !(name in map)) {
          map[name] = typeof job.status === 'string' ? job.status : 'unknown';
        }
      }
      statuses = map;
    } catch (e) {
      if (seq !== loadSeq) return;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  /**
   * В истории строка = задание, и статус у каждого задания свой. Поиск по имени файла
   * (как в таблице gcodes) показывал бы у всех прогонов одного файла статус самого
   * свежего. Строка не передана (сортировка по имени) — фолбэк на статус по имени.
   */
  function statusOf(filename: string, row?: { raw?: Record<string, unknown> }): string | null {
    const own = row?.raw?.status;
    if (typeof own === 'string' && own) return own;
    if (currentPrint && currentPrint.filename === filename) return currentPrint.state;
    return statuses[filename] ?? null;
  }

  function navigate(_p: string): void {
    // история плоская: навигации нет
  }

  function init(): void {
    for (const u of unsubs.splice(0)) u();

    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.onNotify('notify_history_changed', () => {
        void load();
      }),
    );

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
        if (s === 'open') void load();
      }),
    );

    if (h.readyState === 'open') void load();
  }

  init();

  function destroy(): void {
    for (const u of unsubs) u();
  }

  return {
    get path() {
      return '';
    },
    get dirs() {
      return [] as Array<{ dirname: string; modified: number; size: number }>;
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

export type HistoryFilesStore = ReturnType<typeof createHistoryFilesCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<HistoryFilesStore>({
  create: (pid, api) => createHistoryFilesCore(api, pid),
  cap: 4,
});

/**
 * Хук списка истории печати.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером.
 * С printerId — fleet: прямое ядро с удержанием.
 */
export function useHistoryFiles(
  api: PluginApi,
  printerId?: string,
): HistoryFilesStore {
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

  return createDelegateStore<HistoryFilesStore>(() => keeper.get(api.printer.id, api));
}