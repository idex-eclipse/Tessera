import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../../../plugin-sdk/src/types';
import { MemoryStorage } from '../storage';
import { checkDeprecatedPluginApis, HOST_NOTICE_STORAGE_KEY } from '../plugin-api-deprecation';
import type { LoadedPlugin } from '../plugin-loader.svelte';
import type { RemotePluginRecord } from '../types';

/** The fake keeps the notification contract visible without mounting the shell. */
function setup(storage = new MemoryStorage()) {
  const push = vi.fn();
  const rememberApi = vi.fn();
  const readManifest = vi.fn<(url: string) => Promise<PluginManifest>>();
  const run = (records: RemotePluginRecord[], loaded: LoadedPlugin[] = []) => checkDeprecatedPluginApis({
    records, loaded, readManifest, rememberApi, storage,
    notifications: { push },
    i18n: { t: (key: string, params?: Record<string, string | number>) => `${key}:${JSON.stringify(params ?? {})}` },
  });
  return { storage, push, rememberApi, readManifest, run };
}

/** An installed record identifies a plugin even when it is disabled. */
function record(url: string, enabled: boolean, pluginApi?: string): RemotePluginRecord {
  return { manifestUrl: url, enabled, printerIds: [], ...(pluginApi ? { pluginApi } : {}) };
}

/** Loaded plugins already have a validated manifest and need no extra request. */
function loaded(url: string, name: string, pluginApi?: string): LoadedPlugin {
  return { source: 'remote', manifestUrl: url, module: {}, manifest: { id: name, name, version: '1.0.0', entry: 'index.js', pluginApi } };
}

describe('deprecated plugin API notice', () => {
  it('uses loaded enabled manifests and groups legacy plugins into one host notice', async () => {
    const f = setup();
    await f.run([record('/old', true), record('/new', true)], [loaded('/old', 'Old'), loaded('/new', 'New', '1.0')]);
    expect(f.readManifest).not.toHaveBeenCalled();
    expect(f.push).toHaveBeenCalledTimes(1);
    expect(f.push.mock.calls[0]![0]).toMatchObject({ printerId: '', pluginId: '@host', severity: 'info', actions: [{ kind: 'host-settings', section: 'plugins' }] });
    expect(f.push.mock.calls[0]![0].text).toContain('Old');
    expect(f.push.mock.calls[0]![0].text).not.toContain('New');
    expect(f.rememberApi).toHaveBeenCalledWith('/old', '0.7', 'Old');
  });

  it('reads a disabled manifest without importing its code', async () => {
    const f = setup();
    f.readManifest.mockResolvedValue({ id: 'old', name: 'Disabled', version: '1.0.0', entry: 'index.js', pluginApi: '0.14' });
    await f.run([record('/disabled', false)]);
    expect(f.readManifest).toHaveBeenCalledWith('/disabled');
    expect(f.rememberApi).toHaveBeenCalledWith('/disabled', '0.14', 'Disabled');
    expect(f.push.mock.calls[0]![0].text).toContain('Disabled');
  });

  it('uses the verified cache offline and retries unknown manifests on another run', async () => {
    const f = setup();
    f.readManifest.mockRejectedValue(new Error('offline'));
    await f.run([record('/cached', false, '0.14'), record('/unknown', false)]);
    expect(f.push).toHaveBeenCalledTimes(1);
    f.readManifest.mockResolvedValue({ id: 'unknown', name: 'Unknown', version: '1.0.0', entry: 'index.js', pluginApi: '0.14' });
    await f.run([record('/cached', false, '0.14'), record('/unknown', false)]);
    expect(f.push).toHaveBeenCalledTimes(2);
  });

  it('notifies only when the old-plugin set changes and resets after removal', async () => {
    const f = setup();
    const old = record('/old', true);
    await f.run([old], [loaded('/old', 'Old', '0.14')]);
    const restarted = setup(f.storage);
    await restarted.run([old], [loaded('/old', 'Old', '0.14')]);
    expect(f.push).toHaveBeenCalledTimes(1);
    expect(restarted.push).not.toHaveBeenCalled();
    await f.run([], []);
    expect(f.storage.getItem(HOST_NOTICE_STORAGE_KEY)).toContain('"plugin-api-0.x":""');
    await f.run([old], [loaded('/old', 'Old', '0.14')]);
    expect(f.push).toHaveBeenCalledTimes(2);
  });

  it('does not warn for API 1.0 or unsupported 0.15', async () => {
    const f = setup();
    await f.run([record('/current', true), record('/future', true)], [loaded('/current', 'Current', '1.0'), loaded('/future', 'Future', '0.15')]);
    expect(f.push).not.toHaveBeenCalled();
  });

  it('bounds the plugin list when many installed names are long', async () => {
    const f = setup();
    const records = Array.from({ length: 8 }, (_, index) => record(`/old-${index}`, true));
    const plugins = records.map((item, index) => loaded(item.manifestUrl, `Very long old plugin ${index} with an even longer name`, '0.14'));
    await f.run(records, plugins);
    expect(f.push).toHaveBeenCalledOnce();
    expect(f.push.mock.calls[0]![0].text.length).toBeLessThanOrEqual(240);
    expect(f.push.mock.calls[0]![0].text).toContain('notifications.deprecated.more');
  });
});
