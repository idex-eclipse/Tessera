import { onDestroy } from 'svelte';

import type { PluginApi } from '../../../plugin-sdk/src/types';

export interface DirEntry { dirname: string; modified: number; size: number; }
export interface FileEntry { filename: string; modified: number; size: number; }

export function useDirFiles(api: PluginApi, root: string) {
  let path = $state('');
  let dirs = $state<DirEntry[]>([]);
  let files = $state<FileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  const unsubs: Array<() => void> = [];

  function fullPath(): string {
    return path ? `${root}/${path}` : root;
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const res = await api
        .moonraker()
        .request<{ dirs?: Array<Record<string, any>>; files?: Array<Record<string, any>> }>(
          'server.files.get_directory',
          { path: fullPath() },
        );

      dirs = (res.dirs ?? [])
        .map((d) => ({ dirname: d.dirname ?? '', modified: d.modified ?? 0, size: d.size ?? 0 }))
        .filter((d) => d.dirname !== '');

      files = (res.files ?? [])
        .map((f) => ({ filename: f.filename ?? '', modified: f.modified ?? 0, size: f.size ?? 0 }))
        .filter((f) => f.filename !== '');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      dirs = [];
      files = [];
    } finally {
      loading = false;
    }
  }

  function init(): void {
    for (const u of unsubs.splice(0)) u();

    let h;
    try {
      h = api.moonraker();
    } catch {
      return;
    }

    unsubs.push(h.onNotify('notify_filelist_changed', () => void load()));
    unsubs.push(
      h.onConnectionStatusChange((s) => {
        if (s === 'open') void load();
      }),
    );

    if (h.readyState === 'open') void load();
  }

  init();

  const off = api.onPrinterChange(() => {
    path = '';
    init();
  });

  onDestroy(() => {
    for (const u of unsubs) u();
    off();
  });

  return {
    get path() { return path; },
    get dirs() { return dirs; },
    get files() { return files; },
    get loading() { return loading; },
    get error() { return error; },
    navigate(p: string): void {
      path = p;
      void load();
    },
    refresh: load,
  };
}