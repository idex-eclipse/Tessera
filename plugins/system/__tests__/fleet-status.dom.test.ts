import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import StatusPanel from '../components/fleet/StatusPanel.svelte';

const state = vi.hoisted(() => ({ print: 'printing', klippy: 'ready' }));

vi.mock('../../../plugin-sdk/src/svelte/index', () => ({
  useWidget: () => null,
  useI18n: () => ({
    locale: 'en',
    t: (key: string, params?: Record<string, string>) => key === 'fleet.status.cancelPrinterConfirm'
      ? `Cancel the current print on ${params?.name}?` : key,
  }),
}));
vi.mock('../data/use-print-status.svelte.ts', () => ({
  usePrintStatus: () => ({ model: { state: state.print, filename: 'part.gcode' } }),
  computeProgress: () => 0.5,
  computeRemaining: () => 60,
  computeEta: () => null,
  fmtDuration: () => '1m',
  durationUnits: () => ({}),
  fmtClock: () => '12:00',
}));
vi.mock('../../shared/klippy-state/use-klippy-state.svelte.ts', () => ({
  useKlippyState: () => ({ state: state.klippy }),
}));
vi.mock('../fleet-index.ts', () => ({ buildFleetIndex: () => ({ tags: [], searchText: '' }) }));

/** Mount the fleet status with distinct active and card printer handles. */
function setup(request: (method: string) => Promise<unknown>, hasTarget = true) {
  const activeRequest = vi.fn(async () => ({}));
  const targetRequest = vi.fn(request);
  const push = vi.fn();
  const api = {
    printer: { id: 'active', name: 'Active' },
    printers: [{ id: 'active', name: 'Active' }, { id: 'target', name: 'Printer B' }],
    moonrakerFor: vi.fn((id: string) => ({ request: id === 'target' ? targetRequest : activeRequest })),
    fleet: { publish: vi.fn(), retract: vi.fn() },
    notifications: { push },
    i18n: { t: (key: string) => key },
  } as unknown as PluginApi;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(StatusPanel, {
    target,
    props: { mpuApi: api, mpuParams: hasTarget ? { printerId: 'target' } : {} },
  });
  flushSync();
  return {
    target, activeRequest, targetRequest, push,
    stop: () => { unmount(component); target.remove(); },
  };
}

describe('fleet print actions', () => {
  it('pauses only the card printer and blocks repeated requests while pending', async () => {
    state.print = 'printing'; state.klippy = 'ready';
    let finish!: (value: unknown) => void;
    const view = setup(() => new Promise((resolve) => { finish = resolve; }));
    try {
      const pause = view.target.querySelectorAll('button')[0] as HTMLButtonElement;
      pause.click();
      flushSync();
      expect(pause.disabled).toBe(true);
      pause.click();
      expect(view.targetRequest).toHaveBeenCalledTimes(1);
      expect(view.targetRequest).toHaveBeenCalledWith('printer.print.pause');
      expect(view.activeRequest).not.toHaveBeenCalled();
      finish({});
      await vi.waitFor(() => expect(pause.disabled).toBe(false));
    } finally { view.stop(); }
  });

  it('resumes and confirms cancellation with the target printer name', async () => {
    state.print = 'paused'; state.klippy = 'ready';
    const view = setup(async () => ({}));
    try {
      const buttons = view.target.querySelectorAll('button');
      buttons[0]?.click();
      await vi.waitFor(() => expect(view.targetRequest).toHaveBeenCalledWith('printer.print.resume'));
      await vi.waitFor(() => expect((buttons[1] as HTMLButtonElement).disabled).toBe(false));
      buttons[1]?.click();
      flushSync();
      expect(view.target.textContent).toContain('Printer B');
      expect(view.target.textContent).toContain('fleet.status.keepPrinting');
      const confirm = view.target.querySelector('.dialog .btn.danger') as HTMLButtonElement;
      confirm.click();
      await vi.waitFor(() => expect(view.targetRequest).toHaveBeenCalledWith('printer.print.cancel'));
      expect(view.activeRequest).not.toHaveBeenCalled();
    } finally { view.stop(); }
  });

  it('offers no action for idle, unavailable, or unbound cards', () => {
    for (const [print, klippy, hasTarget] of [
      ['standby', 'ready', true], ['printing', 'shutdown', true], ['printing', 'ready', false],
    ] as const) {
      state.print = print; state.klippy = klippy;
      const view = setup(async () => ({}), hasTarget);
      try {
        const buttons = view.target.querySelectorAll('.fs-action');
        if (hasTarget && klippy === 'ready') expect(buttons.length).toBe(0);
        else for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
      } finally { view.stop(); }
    }
  });

  it('attributes transport failures to the card printer without duplicating guard notices', async () => {
    state.print = 'printing'; state.klippy = 'ready';
    const failed = setup(async () => { throw new Error('offline'); });
    try {
      (failed.target.querySelector('.fs-action') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(failed.push).toHaveBeenCalledWith(expect.objectContaining({ printerId: 'target', severity: 'error' })));
    } finally { failed.stop(); }

    const denied = setup(async () => { throw { rejection: { code: 'denied_by_guard' } }; });
    try {
      (denied.target.querySelector('.fs-action') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(denied.targetRequest).toHaveBeenCalledTimes(1));
      expect(denied.push).not.toHaveBeenCalled();
    } finally { denied.stop(); }
  });
});
