import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import JobQueueFleetPanel from '../components/fleet/JobQueueFleetPanel.svelte';

const state = vi.hoisted(() => ({
  available: true,
  queueState: 'ready',
  jobs: [{ job_id: 'job-1', filename: 'folder/part.gcode', time_added: 0, time_in_queue: 65 }],
  target: '',
  ready: true,
  pause: vi.fn(),
  start: vi.fn(),
  clearAll: vi.fn(),
  jump: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../../../plugin-sdk/src/svelte/index', () => ({
  useWidget: () => null,
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));
vi.mock('../data/use-job-queue.svelte.ts', () => ({
  useJobQueue: (_api: unknown, printerId?: string) => {
    state.target = printerId ?? '';
    return {
      get available() { return state.available; },
      get state() { return state.queueState; },
      get jobs() { return state.jobs; },
      pause: state.pause,
      start: state.start,
      clearAll: state.clearAll,
      jump: state.jump,
      remove: state.remove,
    };
  },
}));
vi.mock('../../../shared/klippy-state/use-klippy-state.svelte.ts', () => ({
  useKlippyState: () => ({ get ready() { return state.ready; } }),
}));

function setup() {
  const api = {
    printer: { id: 'active', name: 'Active' },
    printers: [{ id: 'active', name: 'Active' }, { id: 'target', name: 'Printer B' }],
    i18n: {
      locale: 'en',
      t: (key: string, params?: Record<string, string>) => key === 'widgets.jobQueue.fleetDialogTitle'
        ? `Job Queue — ${params?.name}` : key,
    },
  } as unknown as PluginApi;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(JobQueueFleetPanel, {
    target,
    props: { mpuApi: api, mpuParams: { printerId: 'target' } },
  });
  flushSync();
  const launcher = target.querySelector('button') as HTMLButtonElement;
  launcher.click();
  flushSync();
  return { target, stop: () => { unmount(component); target.remove(); } };
}

afterEach(() => {
  state.available = true;
  state.queueState = 'ready';
  state.jobs = [{ job_id: 'job-1', filename: 'folder/part.gcode', time_added: 0, time_in_queue: 65 }];
  state.ready = true;
  vi.clearAllMocks();
});

describe('fleet Job Queue dialog', () => {
  it('uses the card printer and the same queue actions as the widget', () => {
    const view = setup();
    try {
      expect(state.target).toBe('target');
      expect(view.target.querySelector('[role="dialog"]')?.textContent).toContain('Job Queue — Printer B');
      expect(view.target.textContent).toContain('part.gcode');
      const pause = [...view.target.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('widgets.jobQueue.pause')) as HTMLButtonElement;
      pause.click();
      expect(state.pause).toHaveBeenCalledTimes(1);
      const remove = view.target.querySelector('button.danger') as HTMLButtonElement;
      remove.click();
      expect(state.remove).toHaveBeenCalledWith(['job-1']);
    } finally { view.stop(); }
  });

  it('preserves unavailable and empty states, including Klipper-not-ready start gating', () => {
    state.available = false;
    let view = setup();
    expect(view.target.textContent).toContain('widgets.jobQueue.unavailable');
    view.stop();

    state.available = true;
    state.jobs = [];
    state.queueState = 'paused';
    view = setup();
    expect(view.target.textContent).toContain('widgets.jobQueue.empty');
    view.stop();

    state.jobs = [{ job_id: 'job-1', filename: 'part.gcode', time_added: 0, time_in_queue: 0 }];
    state.ready = false;
    view = setup();
    const start = [...view.target.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('widgets.jobQueue.start')) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.title).toBe('common.klipperNotReady');
    view.stop();
  });
});
