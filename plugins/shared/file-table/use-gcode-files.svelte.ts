import { onDestroy } from 'svelte';

import type { PluginApi } from '../../../plugin-sdk/src/types';

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

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function numOpt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function strOpt(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
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

export function useGcodeFiles(api: PluginApi) {
  let path = $state('');
  let dirs = $state<GcodeDirEntry[]>([]);
  let files = $state<GcodeFileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let statuses = $state<Record<string, string>>({});
  let currentPrint = $state<{ filename: string; state: string } | null>(null);

  const unsubs: Array<() => void> = [];

  function dirPath(): string {
    return path ? `gcodes/${path}` : 'gcodes';
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const res = await api
        .moonraker()
        .request<DirectoryResponse>('server.files.get_directory', {
          path: dirPath(),
          extended: true,
        });

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
          print_start_time: typeof f.print_start_time === 'number' ? f.print_start_time : null,
          thumbnails: Array.isArray(f.thumbnails) ? f.thumbnails : [],
          raw: f, // ← весь сырой metadata-объект; из него читаются чипы/цвета/массивы
        }))
        .sort((a, b) => b.modified - a.modified);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const res = await api
        .moonraker()
        .request<{ jobs?: Array<Record<string, any>> }>('server.history.list', { limit: 200 });

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
    if (currentPrint && currentPrint.filename === filename) return currentPrint.state;
    return statuses[filename] ?? null;
  }

  function navigate(p: string): void {
    path = p;
    void load();
  }

  function init(): void {
    //console.info('[gcode-files] init for', api.printer.id);
    for (const u of unsubs.splice(0)) u();

    let h;
    try {
      h = api.moonraker();
    } catch {
      return;
    }

    unsubs.push(
      h.onNotify('notify_filelist_changed', () => {
        void load();
        void loadHistory();
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

  const offPrinter = api.onPrinterChange(() => {
    path = '';
    currentPrint = null;
    init();
  });

  onDestroy(() => {
    for (const u of unsubs) u();
    offPrinter();
  });

  return {
    get path() { return path; },
    get dirs() { return dirs; },
    get files() { return files; },
    get loading() { return loading; },
    get error() { return error; },
    navigate,
    refresh: load,
    statusOf,
  };
}