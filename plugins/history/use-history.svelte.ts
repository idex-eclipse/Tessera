import type { PluginApi } from '../../plugin-sdk/src/types';

export interface HistoryJob {
  job_id: string;
  exists: boolean;
  end_time: number;
  filament_used: number;
  filename: string;
  print_duration: number;
  status: string;
  start_time: number;
  total_duration: number;
  metadata?: Record<string, unknown>;
}

export interface HistoryTotals {
  total_jobs: number;
  total_time: number;
  total_print_time: number;
  total_filament_used: number;
  longest_job: number;
  longest_time: number;
}

export function useHistory(api: PluginApi) {
  let jobs = $state<HistoryJob[]>([]);
  let totals = $state<HistoryTotals | null>(null);
  let loading = $state(true);
  let limit = $state(100);

  let debounce: ReturnType<typeof setTimeout> | null = null;

  async function reload(): Promise<void> {
    try {
      const [list, tot] = await Promise.all([
        api.moonraker().request<any>('server.history.list', { limit, order: 'desc' }),
        api.moonraker().request<any>('server.history.totals'),
      ]);
      jobs = Array.isArray(list?.jobs) ? list.jobs : [];
      totals = tot?.job_totals ?? null;
    } catch {
      // offline / klippy not ready
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const h = api.moonraker();
    const offNotify = h.onNotify('notify_history_changed', () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void reload(), 300);
    });
    const offReady = h.onReady(() => void reload());
    void reload();
    return () => {
      offNotify();
      offReady();
      if (debounce) clearTimeout(debounce);
    };
  });

  async function loadAll(): Promise<void> {
    limit = 10_000;
    await reload();
  }

  async function resetTotals(): Promise<void> {
    await api.moonraker().request('server.history.reset_totals');
    await reload();
  }

  async function deleteAll(): Promise<void> {
    await api.moonraker().request('server.history.delete_all');
    await reload();
  }

  return { jobs, totals, loading, reload, loadAll, resetTotals, deleteAll };
}