import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoonrakerProxyHandle, PluginApi } from '../../../../plugin-sdk/src/types';
import { configBackupRef, createFileOps } from '../file-ops';
import { configBackupHunkEdit, configComparisonRows, configCurrentLineMarks, configDiffHunks, diffConfigLines } from '../config-diff';
import { dispatchConfigRestart, sendConfigRestart } from '../config-restart-command';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('config backup', () => {
  it('protects cfg and conf in nested config paths only', () => {
    expect(configBackupRef({ root: 'config', path: 'macros/a.cfg', isDir: false })?.path).toBe('.backup/macros/a.cfg.bak');
    expect(configBackupRef({ root: 'config', path: 'moonraker.conf', isDir: false })?.path).toBe('.backup/moonraker.conf.bak');
    expect(configBackupRef({ root: 'config', path: 'notes.txt', isDir: false })).toBeNull();
    expect(configBackupRef({ root: 'gcodes', path: 'a.cfg', isDir: false })).toBeNull();
  });

  it('copies before upload and replaces the same backup on the next save', async () => {
    const order: string[] = [];
    const directories = new Set<string>();
    const request = vi.fn(async (method: string, params: unknown) => {
      order.push(`${method}:${JSON.stringify(params)}`);
      const path = (params as { path?: string }).path;
      if (method === 'server.files.get_directory' && path && !directories.has(path)) throw new Error('missing');
      if (method === 'server.files.post_directory' && path) directories.add(path);
    });
    const fetchMock = vi.fn(async () => {
      order.push('upload');
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);
    const target = { request, httpBaseUrl: 'http://printer', authToken: null } as unknown as MoonrakerProxyHandle;
    const api = { moonraker: () => target } as unknown as PluginApi;
    const ops = createFileOps(api);
    const ref = { root: 'config', path: 'sub/a.cfg', isDir: false };
    await ops.saveConfigText(ref, 'one');
    await ops.saveConfigText(ref, 'two');
    expect(order).toEqual([
      'server.files.get_directory:{"path":"config/.backup"}',
      'server.files.post_directory:{"path":"config/.backup"}',
      'server.files.get_directory:{"path":"config/.backup/sub"}',
      'server.files.post_directory:{"path":"config/.backup/sub"}',
      'server.files.copy:{"source":"config/sub/a.cfg","dest":"config/.backup/sub/a.cfg.bak"}', 'upload',
      'server.files.get_directory:{"path":"config/.backup"}',
      'server.files.get_directory:{"path":"config/.backup/sub"}',
      'server.files.copy:{"source":"config/sub/a.cfg","dest":"config/.backup/sub/a.cfg.bak"}', 'upload',
    ]);
  });

  it('does not upload if the backup fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const target = {
      request: vi.fn(async (method: string) => {
        if (method === 'server.files.copy') throw new Error('copy failed');
      }),
      httpBaseUrl: 'http://printer', authToken: null,
    } as unknown as MoonrakerProxyHandle;
    const ops = createFileOps({ moonraker: () => target } as unknown as PluginApi);
    await expect(ops.saveConfigText({ root: 'config', path: 'a.cfg', isDir: false }, 'edited')).rejects.toThrow('copy failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not upload when a nested backup directory cannot be created', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const request = vi.fn(async (method: string) => {
      if (method === 'server.files.get_directory' || method === 'server.files.post_directory') {
        throw new Error('config root is read-only');
      }
    });
    const target = { request, httpBaseUrl: 'http://printer', authToken: null } as unknown as MoonrakerProxyHandle;
    const ops = createFileOps({ moonraker: () => target } as unknown as PluginApi);
    await expect(ops.saveConfigText({ root: 'config', path: 'sub/a.cfg', isDir: false }, 'edited'))
      .rejects.toThrow('config root is read-only');
    expect(request).not.toHaveBeenCalledWith('server.files.copy', expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a legacy sibling backup when the hidden backup has not been created yet', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return url.includes('/.backup/')
        ? { ok: false, status: 404 }
        : { ok: true, text: async () => 'older copy' };
    }));
    const target = { httpBaseUrl: 'http://printer', authToken: null } as unknown as MoonrakerProxyHandle;
    const ops = createFileOps({ moonraker: () => target } as unknown as PluginApi);
    const backup = await ops.readConfigBackup({ root: 'config', path: 'sub/a.cfg', isDir: false });
    expect(backup?.text).toBe('older copy');
    expect(backup?.ref.path).toBe('sub/a.cfg.bak');
    expect(urls).toHaveLength(2);
  });

  it('reports an upload failure after a successful backup without deleting it', async () => {
    const request = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 507 })));
    const target = { request, httpBaseUrl: 'http://printer', authToken: null } as unknown as MoonrakerProxyHandle;
    const ops = createFileOps({ moonraker: () => target } as unknown as PluginApi);
    await expect(ops.saveConfigText({ root: 'config', path: 'a.cfg', isDir: false }, 'edited')).rejects.toThrow('HTTP 507');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('server.files.copy', {
      source: 'config/a.cfg', dest: 'config/.backup/a.cfg.bak',
    });
  });

  it('keeps a line insertion aligned in the comparison', () => {
    expect(diffConfigLines('first\nlast', 'first\nnew\nlast')).toEqual([
      { kind: 'same', text: 'first' }, { kind: 'added', text: 'new' }, { kind: 'same', text: 'last' },
    ]);
  });

  it('numbers inserted and removed lines on their own sides', () => {
    expect(configComparisonRows('old\nkeep', 'new\nkeep')).toEqual([
      { kind: 'removed', text: 'old', beforeLine: 1, afterLine: null },
      { kind: 'added', text: 'new', beforeLine: null, afterLine: 1 },
      { kind: 'same', text: 'keep', beforeLine: 2, afterLine: 2 },
    ]);
  });

  it('marks edited current lines and anchors deletions to a surviving line', () => {
    expect([...configCurrentLineMarks('old\nkeep', 'new\nkeep')]).toEqual([[1, 'changed']]);
    expect([...configCurrentLineMarks('first\nremoved\nlast', 'first\nlast')]).toEqual([[2, 'removed']]);
    expect([...configCurrentLineMarks('first\nlast', 'first\nlast\nnew')]).toEqual([[3, 'added']]);
  });

  it('groups adjacent replacement lines but keeps separate changes independent', () => {
    const before = 'a\nold1\nb\nold2\nc';
    const after = 'a\nnew1\nb\nnew2\nc';
    expect(configDiffHunks(before, after)).toEqual([
      { beforeStart: 1, beforeEnd: 2, afterStart: 1, afterEnd: 2 },
      { beforeStart: 3, beforeEnd: 4, afterStart: 3, afterEnd: 4 },
    ]);
    const edit = configBackupHunkEdit(before, after, configDiffHunks(before, after)[0]!);
    expect(after.slice(0, edit.start) + edit.insert + after.slice(edit.end)).toBe('a\nold1\nb\nnew2\nc');
  });

  it.each([
    ['a\nz', 'a\nnew\nz', 'a\nz'],
    ['a\nold\nz', 'a\nz', 'a\nold\nz'],
    ['a\n\nz', 'a\nx\nz', 'a\n\nz'],
    ['a\nold\n', 'a\nnew\n', 'a\nold\n'],
    ['a\n', 'a', 'a\n'],
  ])('restores one insertion, deletion or trailing line (%j)', (before, after, expected) => {
    const hunks = configDiffHunks(before, after);
    expect(hunks).toHaveLength(1);
    const edit = configBackupHunkEdit(before, after, hunks[0]!);
    expect(after.slice(0, edit.start) + edit.insert + after.slice(edit.end)).toBe(expected);
  });
});

describe('config restart command', () => {
  it('sends only a Klipper restart request for a saved cfg', async () => {
    const request = vi.fn(async () => ({}));
    const target = { request } as unknown as MoonrakerProxyHandle;
    await sendConfigRestart(target, { root: 'config', path: 'macros/a.cfg', isDir: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('printer.firmware_restart', {});
  });

  it('sends only a Moonraker restart request for moonraker.conf', async () => {
    const request = vi.fn(async () => ({}));
    const target = { request } as unknown as MoonrakerProxyHandle;
    await sendConfigRestart(target, { root: 'config', path: 'moonraker.conf', isDir: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('machine.services.restart', { service: 'moonraker' });
  });

  it('restarts the Klipper service when Klippy is in a startup error', async () => {
    const request = vi.fn(async () => ({}));
    const target = { request } as unknown as MoonrakerProxyHandle;
    await sendConfigRestart(target, { root: 'config', path: 'printer.cfg', isDir: false }, 'error');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('machine.services.restart', { service: 'klipper' });
  });

  it('keeps firmware restart for an MCU shutdown', async () => {
    const request = vi.fn(async () => ({}));
    const target = { request } as unknown as MoonrakerProxyHandle;
    await sendConfigRestart(target, { root: 'config', path: 'printer.cfg', isDir: false }, 'shutdown');
    expect(request).toHaveBeenCalledWith('printer.firmware_restart', {});
  });

  it('does not keep the UI waiting for an unanswered restart request', async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => new Promise<unknown>(() => {}));
    const onError = vi.fn();
    const target = { request } as unknown as MoonrakerProxyHandle;
    expect(dispatchConfigRestart(target, { root: 'config', path: 'printer.cfg', isDir: false }, 'error', onError)).toBeUndefined();
    expect(request).toHaveBeenCalledWith('machine.services.restart', { service: 'klipper' });
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a rejected service restart asynchronously', async () => {
    const error = new Error('service restart denied');
    const request = vi.fn(async () => { throw error; });
    const onError = vi.fn();
    const target = { request } as unknown as MoonrakerProxyHandle;
    dispatchConfigRestart(target, { root: 'config', path: 'printer.cfg', isDir: false }, 'error', onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });
});
