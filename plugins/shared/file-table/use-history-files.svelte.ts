import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../core-keeper/core-keeper';

import type { GcodeFileEntry, GcodeThumbnail } from './use-gcode-files.svelte.ts';

interface HistoryListResponse {
  jobs?: Array<Record<string, unknown>>;
  count?: number;
}

/** A normalized Moonraker history job used by both the table and the History plugin. */
export interface HistoryJobEntry extends GcodeFileEntry {
  jobId: string;
  exists: boolean;
  status: string;
  user: string | null;
  startTime: number;
  endTime: number | null;
  printDuration: number;
  totalDuration: number;
  filamentUsed: number;
  metadata: Record<string, unknown>;
  auxiliaryData: Array<Record<string, unknown>>;
}

// Numeric normalization prevents malformed history data from leaking NaN into sorting and statistics.
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Optional values stay absent so table cells can render their established empty state.
function numOpt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// Nested Moonraker values are accepted only as plain record-like objects.
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// Invalid thumbnail entries are ignored without rejecting the entire history job.
function thumbnails(value: unknown): GcodeThumbnail[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is GcodeThumbnail => {
    const thumb = record(item);
    return typeof thumb.relative_path === 'string';
  });
}

/** Converts an untrusted Moonraker history object into the table's stable entry shape. */
export function normalizeHistoryJob(job: Record<string, unknown>): HistoryJobEntry | null {
  if (typeof job.filename !== 'string') return null;
  const metadata = record(job.metadata);
  const startTime = num(job.start_time);
  const jobId = typeof job.job_id === 'string' ? job.job_id : '';
  const raw = { ...metadata, ...job };
  return {
    filename: job.filename,
    size: num(metadata.size),
    modified: num(metadata.modified) || startTime,
    slicer: typeof metadata.slicer === 'string' ? metadata.slicer : undefined,
    slicer_version: typeof metadata.slicer_version === 'string' ? metadata.slicer_version : undefined,
    layer_height: numOpt(metadata.layer_height),
    first_layer_height: numOpt(metadata.first_layer_height),
    layer_count: numOpt(metadata.layer_count),
    object_height: numOpt(metadata.object_height),
    nozzle_diameter: numOpt(metadata.nozzle_diameter),
    filament_name: typeof metadata.filament_name === 'string' || Array.isArray(metadata.filament_name)
      ? metadata.filament_name as string | string[]
      : undefined,
    filament_type: typeof metadata.filament_type === 'string' || Array.isArray(metadata.filament_type)
      ? metadata.filament_type as string | string[]
      : undefined,
    filament_total: numOpt(job.filament_used) ?? numOpt(metadata.filament_total),
    filament_weight_total: numOpt(metadata.filament_weight_total),
    estimated_time: numOpt(metadata.estimated_time) ?? numOpt(job.estimate),
    first_layer_extruder_temp: numOpt(metadata.first_layer_extruder_temp),
    first_layer_bed_temp: numOpt(metadata.first_layer_bed_temp),
    chamber_temp: numOpt(metadata.chamber_temp),
    print_start_time: startTime || null,
    job_id: jobId || null,
    thumbnails: thumbnails(metadata.thumbnails),
    raw,
    jobId,
    exists: job.exists === true,
    status: typeof job.status === 'string' ? job.status : 'unknown',
    user: typeof job.user === 'string' ? job.user : null,
    startTime,
    endTime: numOpt(job.end_time) ?? null,
    printDuration: num(job.print_duration),
    totalDuration: num(job.total_duration),
    filamentUsed: num(job.filament_used),
    metadata,
    auxiliaryData: Array.isArray(job.auxiliary_data)
      ? job.auxiliary_data.map(record)
      : [],
  };
}

// History cores are statically bound to one printer and expose a flat, pathless list.
function createHistoryFilesCore(api: PluginApi, printerId: string) {
  let files = $state<HistoryJobEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let statuses = $state<Record<string, string>>({});
  let currentPrint = $state<{ filename: string; state: string } | null>(null);

  const unsubs: Array<() => void> = [];
  // A stale request must not replace a newer notification-driven or manual refresh.
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
        .map(normalizeHistoryJob)
        .filter((job): job is HistoryJobEntry => job !== null);

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

  /** Resolves each job's own status while retaining a filename fallback for table sorting. */
  function statusOf(filename: string, row?: { raw?: Record<string, unknown> }): string | null {
    const own = row?.raw?.status;
    if (typeof own === 'string' && own) return own;
    if (currentPrint && currentPrint.filename === filename) return currentPrint.state;
    return statuses[filename] ?? null;
  }

  function navigate(_p: string): void {
    // History is flat and therefore has no directory navigation.
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
    get printing() {
      return currentPrint?.state === 'printing' || currentPrint?.state === 'paused';
    },
    navigate,
    refresh: load,
    statusOf,
    destroy,
  };
}

export type HistoryFilesStore = ReturnType<typeof createHistoryFilesCore>;

// Per-printer cores survive view unmounts so statistics can reuse the retained full list.
const keeper = createCoreKeeper<HistoryFilesStore>({
  create: (pid, api) => createHistoryFilesCore(api, pid),
  cap: 4,
});

/**
 * Returns the print-history store for the active printer or a retained explicit printer id.
 * Omitting `printerId` follows printer changes; providing it keeps a fleet-scoped core.
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
