import { describe, expect, it, vi } from 'vitest';

import type { RegistryPlugin } from '../extensions-installer.svelte.ts';
import { runUpdateCheck, updateCheckDue, type UpdateCheckDeps } from '../update-check.ts';
import type { UiUpdateStatus } from '../ui-updater.svelte.ts';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const status = (over: Partial<UiUpdateStatus> = {}): UiUpdateStatus => ({
  installed: { commit: 'aaaaaaa', branch: 'main', date: null, version: '1.0.0' },
  remote: { commit: 'bbbbbbb', branch: 'main', date: null, version: '1.1.0' },
  branch: 'main',
  updateAvailable: true,
  canUpdate: true,
  remoteError: null,
  ...over,
});

const plugin = (over: Partial<RegistryPlugin> = {}): RegistryPlugin => ({
  id: 'acme/hello',
  name: 'Hello',
  version: '2.0.0',
  installedVersion: '1.0.0',
  state: 'update',
  description: '',
  managed: true,
  manifestUrl: '/extensions/hello/manifest.json',
  pluginApi: '0.8',
  ...over,
});

/** Minimal settings double: setUpdateCheckSettings merges like the real store. */
function setup(opts: {
  updateCheck?: Partial<{ intervalHours: number; lastCheckedAt: number; notified: Record<string, string> }>;
  ui?: UiUpdateStatus | null;
  plugins?: RegistryPlugin[] | null;
  uiError?: boolean;
} = {}) {
  const settings = {
    ui: { updateCheck: { intervalHours: 4, lastCheckedAt: 0, notified: {}, ...opts.updateCheck } },
    setUpdateCheckSettings(patch: object) {
      settings.ui.updateCheck = { ...settings.ui.updateCheck, ...patch } as typeof settings.ui.updateCheck;
    },
  };
  const push = vi.fn();
  const deps: UpdateCheckDeps = {
    settings: settings as unknown as UpdateCheckDeps['settings'],
    notifications: { push },
    i18n: { t: (key: string, params?: Record<string, unknown>) => `${key}${params ? ' ' + JSON.stringify(params) : ''}` },
    loadUi: opts.uiError ? () => Promise.reject(new Error('x')) : async () => ('ui' in opts ? opts.ui! : status()),
    loadPlugins: async () => ('plugins' in opts ? opts.plugins! : []),
    now: () => NOW,
  };
  return { settings, push, deps };
}

describe('update-check / schedule', () => {
  it('due when never checked, past the interval, or the clock went backwards', () => {
    const base = { intervalHours: 4, notified: {} };
    expect(updateCheckDue({ updateCheck: { ...base, lastCheckedAt: 0 } }, NOW)).toBe(true);
    expect(updateCheckDue({ updateCheck: { ...base, lastCheckedAt: NOW - 4 * HOUR } }, NOW)).toBe(true);
    expect(updateCheckDue({ updateCheck: { ...base, lastCheckedAt: NOW - 4 * HOUR + 1 } }, NOW)).toBe(false);
    expect(updateCheckDue({ updateCheck: { ...base, lastCheckedAt: NOW + HOUR } }, NOW)).toBe(true);
  });

  it('skips the network entirely when not due', async () => {
    const { deps, push } = setup({ updateCheck: { lastCheckedAt: NOW - HOUR } });
    const loadUi = vi.fn(deps.loadUi);
    expect(await runUpdateCheck({ ...deps, loadUi })).toBe(false);
    expect(loadUi).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('honours a custom interval', async () => {
    const { deps } = setup({ updateCheck: { intervalHours: 1, lastCheckedAt: NOW - HOUR } });
    expect(await runUpdateCheck(deps)).toBe(true);
  });
});

describe('update-check / notifications', () => {
  it('announces a Tessera update from the host, without a printer', async () => {
    const { deps, push, settings } = setup();
    expect(await runUpdateCheck(deps)).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatchObject({
      printerId: '',
      pluginId: '@host',
      severity: 'info',
      label: 'notifications.update.source',
    });
    expect(push.mock.calls[0]![0].text).toContain('notifications.update.ui');
    expect(push.mock.calls[0]![0].text).toContain('v1.1.0 (bbbbbbb)');
    expect(settings.ui.updateCheck.lastCheckedAt).toBe(NOW);
    expect(settings.ui.updateCheck.notified.ui).toBe('bbbbbbb');
  });

  it('does not repeat a version it already announced', async () => {
    const { deps, push, settings } = setup({ updateCheck: { notified: { ui: 'bbbbbbb' } } });
    await runUpdateCheck(deps);
    expect(push).not.toHaveBeenCalled();
    expect(settings.ui.updateCheck.lastCheckedAt).toBe(NOW);
  });

  it('announces a newer build after an earlier one was announced', async () => {
    const { deps, push } = setup({ updateCheck: { notified: { ui: 'ccccccc' } } });
    await runUpdateCheck(deps);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('says nothing when everything is current', async () => {
    const { deps, push } = setup({ ui: status({ updateAvailable: false }), plugins: [plugin({ state: 'installed' })] });
    expect(await runUpdateCheck(deps)).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it('groups compatible plugin updates into one message', async () => {
    const { deps, push } = setup({
      ui: status({ updateAvailable: false }),
      plugins: [plugin(), plugin({ id: 'acme/two', name: 'Two', version: '3.0.0' })],
    });
    await runUpdateCheck(deps);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0].text).toContain('notifications.update.plugins');
    expect(push.mock.calls[0]![0].text).toContain('Hello 2.0.0, Two 3.0.0');
  });

  it('reports an update that needs a newer Tessera separately', async () => {
    const { deps, push } = setup({
      ui: status({ updateAvailable: false }),
      plugins: [plugin({ pluginApi: '99.0' }), plugin({ id: 'acme/ok', name: 'Ok' })],
    });
    await runUpdateCheck(deps);
    const texts = push.mock.calls.map((c) => c[0].text as string);
    expect(texts).toHaveLength(2);
    expect(texts.some((t) => t.includes('notifications.update.pluginsNeedUi') && t.includes('Hello'))).toBe(true);
    expect(texts.some((t) => t.includes('notifications.update.plugins ') && t.includes('Ok'))).toBe(true);
  });

  it('ignores plugins the service does not manage and plugins without an update', async () => {
    const { deps, push } = setup({
      ui: status({ updateAvailable: false }),
      plugins: [plugin({ managed: false }), plugin({ id: 'a/b', state: 'available' }), plugin({ id: 'c/d', state: 'local' })],
    });
    await runUpdateCheck(deps);
    expect(push).not.toHaveBeenCalled();
  });

  it('a plugin update announced before is announced again when its version changes', async () => {
    const first = setup({ ui: status({ updateAvailable: false }), plugins: [plugin()] });
    await runUpdateCheck(first.deps);
    expect(first.push).toHaveBeenCalledTimes(1);

    const second = setup({
      ui: status({ updateAvailable: false }),
      plugins: [plugin({ version: '2.1.0' })],
      updateCheck: { notified: first.settings.ui.updateCheck.notified },
    });
    await runUpdateCheck(second.deps);
    expect(second.push).toHaveBeenCalledTimes(1);
  });

  it('forgets a gone update, so one that returns is announced again', async () => {
    const { deps, push, settings } = setup({
      ui: status({ updateAvailable: false }),
      plugins: [],
      updateCheck: { notified: { ui: 'bbbbbbb', plugins: 'acme/hello@2.0.0' } },
    });
    await runUpdateCheck(deps);
    expect(settings.ui.updateCheck.notified).toEqual({});
    expect(push).not.toHaveBeenCalled();
  });
});

describe('update-check / unavailable services', () => {
  it('no services at all: not counted as a check, so the next open retries', async () => {
    const { deps, push, settings } = setup({ ui: null, plugins: null });
    expect(await runUpdateCheck(deps)).toBe(false);
    expect(settings.ui.updateCheck.lastCheckedAt).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('one service answers: its news are shown, the other source keeps its memory', async () => {
    const { deps, push, settings } = setup({
      ui: null,
      plugins: [plugin()],
      updateCheck: { notified: { ui: 'bbbbbbb' } },
    });
    expect(await runUpdateCheck(deps)).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(settings.ui.updateCheck.notified.ui).toBe('bbbbbbb');
  });

  it('a throwing loader is treated as unavailable', async () => {
    const { deps, push } = setup({ uiError: true, plugins: [plugin()] });
    expect(await runUpdateCheck(deps)).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
