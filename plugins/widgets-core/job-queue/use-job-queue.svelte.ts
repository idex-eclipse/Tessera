import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

export type QueueState = 'ready' | 'loading' | 'starting' | 'paused' | 'unknown';

export interface QueuedJob {
  job_id: string;
  filename: string;
  time_added: number;
  time_in_queue: number;
}

let jobs = $state<QueuedJob[]>([]);
let state = $state<QueueState>('unknown');
let available = $state<boolean>(true);

export function useJobQueue(api: PluginApi) {
  let generation = 0;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonraker();
    } catch {
      return null;
    }
  }

  async function req<T>(method: string, params?: unknown): Promise<T | null> {
    const h = safeHandle();
    if (!h) return null;
    try {
      return (await h.request<T>(method, params)) as T;
    } catch (e) {
      console.error(`[job-queue] ${method} failed:`, e);
      return null;
    }
  }

  function applyStatus(s: any): void {
    if (!s || typeof s !== 'object') return;

    const list = Array.isArray(s.queued_jobs)
      ? s.queued_jobs
      : Array.isArray(s.updated_queue)
        ? s.updated_queue
        : null;

    if (list) {
      jobs = (list as any[])
        .filter((j) => j && typeof j.job_id === 'string')
        .map((j) => ({
          job_id: j.job_id,
          filename: String(j.filename ?? ''),
          time_added: Number(j.time_added ?? 0),
          time_in_queue: Number(j.time_in_queue ?? 0),
        }));
    }

    if (typeof s.queue_state === 'string') {
      state = s.queue_state as QueueState;
    }
  }

  async function refresh(gen: number): Promise<void> {
    const s = await req<any>('server.job_queue.status');
    if (gen !== generation) return;
    if (s == null) {
      available = false;
      jobs = [];
      state = 'unknown';
    } else {
      available = true;
      applyStatus(s);
    }
  }


  // Actions


  async function remove(ids: string[]): Promise<void> {
    const s = await req<any>('server.job_queue.delete_job', { job_ids: ids });
    if (s) applyStatus(s);
  }

  async function clearAll(): Promise<void> {
    const s = await req<any>('server.job_queue.delete_job', { all: true });
    if (s) applyStatus(s);
  }

  async function pause(): Promise<void> {
    const s = await req<any>('server.job_queue.pause');
    if (s) applyStatus(s);
  }

  async function start(): Promise<void> {
    const s = await req<any>('server.job_queue.start');
    if (s) applyStatus(s);
  }

  async function jump(job_id: string): Promise<void> {
    const s = await req<any>('server.job_queue.jump', { job_id });
    if (s) applyStatus(s);
  }

  // Lifecycle

  function teardown(): void {
    generation++;
    for (const u of unsubs.splice(0)) u();
  }

  async function init(): Promise<void> {
    const gen = ++generation;
    const h = safeHandle();
    if (!h || !api.printer.url) return;

    unsubs.push(h.onReady(() => {
      if (gen === generation) void refresh(gen);
    }));
    unsubs.push(
      h.onNotify('notify_job_queue_changed', (p: any) => {
        if (gen !== generation) return;
        // params: [{ action, updated_queue, queue_state }]
        const delta = Array.isArray(p) ? p[0] : p;
        applyStatus(delta);
      }),
    );

    await refresh(gen);
  }

  init();

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    jobs = [];
    state = 'unknown';
    available = true;
    void init();
  });

  onDestroy(() => {
    teardown();
    offPrinter();
  });

  return {
    get jobs() { return jobs; },
    get state() { return state; },
    get available() { return available; },
    remove,
    clearAll,
    pause,
    start,
    jump,
  };
}