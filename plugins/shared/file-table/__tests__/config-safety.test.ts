import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoonrakerProxyHandle, PluginApi } from '../../../../plugin-sdk/src/types';
import { configBackupRef, createFileOps } from '../file-ops';
import { diffConfigLines } from '../config-diff';
import { checkConfigRestart } from '../config-restart';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('config backup', () => {
  it('protects cfg and conf in nested config paths only', () => {
    expect(configBackupRef({ root: 'config', path: 'macros/a.cfg', isDir: false })?.path).toBe('macros/a.cfg.bak');
    expect(configBackupRef({ root: 'config', path: 'moonraker.conf', isDir: false })?.path).toBe('moonraker.conf.bak');
    expect(configBackupRef({ root: 'config', path: 'notes.txt', isDir: false })).toBeNull();
    expect(configBackupRef({ root: 'gcodes', path: 'a.cfg', isDir: false })).toBeNull();
  });

  it('copies before upload, replaces the same backup, and restores without consuming it', async () => {
    const order: string[] = [];
    const request = vi.fn(async (method: string, params: unknown) => {
      order.push(`${method}:${JSON.stringify(params)}`);
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
    await ops.restoreConfigBackup(ref);
    expect(order).toEqual([
      'server.files.copy:{"source":"config/sub/a.cfg","dest":"config/sub/a.cfg.bak"}', 'upload',
      'server.files.copy:{"source":"config/sub/a.cfg","dest":"config/sub/a.cfg.bak"}', 'upload',
      'server.files.copy:{"source":"config/sub/a.cfg.bak","dest":"config/sub/a.cfg"}',
    ]);
  });

  it('does not upload if the backup fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const target = {
      request: vi.fn(async () => { throw new Error('copy failed'); }),
      httpBaseUrl: 'http://printer', authToken: null,
    } as unknown as MoonrakerProxyHandle;
    const ops = createFileOps({ moonraker: () => target } as unknown as PluginApi);
    await expect(ops.saveConfigText({ root: 'config', path: 'a.cfg', isDir: false }, 'edited')).rejects.toThrow('copy failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an upload failure after a successful backup without deleting it', async () => {
    const request = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 507 })));
    const target = { request, httpBaseUrl: 'http://printer', authToken: null } as unknown as MoonrakerProxyHandle;
    const ops = createFileOps({ moonraker: () => target } as unknown as PluginApi);
    await expect(ops.saveConfigText({ root: 'config', path: 'a.cfg', isDir: false }, 'edited')).rejects.toThrow('HTTP 507');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('server.files.copy', {
      source: 'config/a.cfg', dest: 'config/a.cfg.bak',
    });
  });

  it('keeps a line insertion aligned in the comparison', () => {
    expect(diffConfigLines('first\nlast', 'first\nnew\nlast')).toEqual([
      { kind: 'same', text: 'first' }, { kind: 'added', text: 'new' }, { kind: 'same', text: 'last' },
    ]);
  });
});

describe('restart verification', () => {
  function setup() {
    const events = new Map<string, () => void>();
    let connection: (state: 'open' | 'closed') => void = () => {};
    const request = vi.fn(async (method: string) => method === 'printer.info' ? { state: 'ready' } : { klippy_state: 'ready' });
    const handle = {
      readyState: 'open', request,
      onNotify: (event: string, cb: () => void) => { events.set(event, cb); return () => events.delete(event); },
      onConnectionStatusChange: (cb: typeof connection) => { connection = cb; return () => { connection = () => {}; }; },
    } as unknown as MoonrakerProxyHandle;
    return { handle, events, request, emitConnection: (state: 'open' | 'closed') => connection(state) };
  }

  it('does not accept the old ready state before a Klipper lifecycle event', async () => {
    vi.useFakeTimers();
    const s = setup();
    const result = checkConfigRestart(s.handle, 'klipper', async () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.request).not.toHaveBeenCalled();
    s.events.get('notify_klippy_started')?.();
    expect(await result).toBe('ready');
  });

  it('does not count a Moonraker socket reconnect as a Klipper restart', async () => {
    vi.useFakeTimers();
    const s = setup();
    const result = checkConfigRestart(s.handle, 'klipper', async () => {}, 3000);
    s.emitConnection('closed');
    s.emitConnection('open');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe('timeout');
    expect(s.request).not.toHaveBeenCalled();
  });

  it('does not mistake an early shutdown notification for a failed new startup', async () => {
    vi.useFakeTimers();
    const s = setup();
    const result = checkConfigRestart(s.handle, 'klipper', async () => {}, 3000);
    s.events.get('notify_klippy_shutdown')?.();
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.request).not.toHaveBeenCalled();
    s.events.get('notify_klippy_started')?.();
    expect(await result).toBe('ready');
  });

  it('reports startup errors and keeps the backup available', async () => {
    const s = setup();
    s.request.mockResolvedValue({ state: 'error' });
    const result = checkConfigRestart(s.handle, 'klipper', async () => {});
    s.events.get('notify_klippy_started')?.();
    expect(await result).toBe('error');
  });

  it('requires a Moonraker disconnect and reconnect', async () => {
    const s = setup();
    const result = checkConfigRestart(s.handle, 'moonraker', async () => {});
    s.emitConnection('closed');
    s.emitConnection('open');
    expect(await result).toBe('ready');
    expect(s.request).toHaveBeenCalledWith('server.info');
  });

  it('times out when no new lifecycle is observed', async () => {
    vi.useFakeTimers();
    const s = setup();
    const result = checkConfigRestart(s.handle, 'klipper', async () => {}, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe('timeout');
  });

  it('keeps the backup when the restart request is rejected', async () => {
    const s = setup();
    const result = await checkConfigRestart(s.handle, 'klipper', async () => {
      throw new Error('guard denied');
    });
    expect(result).toBe('rejected');
  });
});
