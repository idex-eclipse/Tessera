import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoonrakerProxyHandle, PluginApi } from '../../../../plugin-sdk/src/types';
import { restoreConfigAttempt } from '../config-restart-recovery';
import { configFingerprint, configRestartMonitor, type RestartAttempt } from '../config-restart-monitor';
import { restartAttemptBackupRef, type FileRef } from '../file-ops';

const configFile = (path: string): FileRef => ({ root: 'config', path, isDir: false });

/** Persist a completed failure so recovery exercises the same path as a reloaded UI. */
function recoveryFixture(printerId: string, changedSecond = false) {
  const first = configFile('a.cfg');
  const second = configFile('b.cfg');
  const aBackup = restartAttemptBackupRef(first, 'multi')!;
  const bBackup = restartAttemptBackupRef(second, 'multi')!;
  const attempt: RestartAttempt = {
    id: 'multi', printerId, file: first, backup: aBackup,
    writtenFingerprint: configFingerprint('new a'),
    files: [
      { file: first, backup: aBackup, writtenFingerprint: configFingerprint('new a') },
      { file: second, backup: bBackup, writtenFingerprint: configFingerprint('new b') },
    ],
    deadline: Date.now() - 1, observedStartup: true, phase: 'failed',
  };
  const stored = new Map([[`tessera:config-restart:${printerId}`, JSON.stringify(attempt)]]);
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
  const contents = new Map([
    ['config/a.cfg', 'new a'], ['config/b.cfg', changedSecond ? 'later b' : 'new b'],
    [`config/${aBackup.path}`, 'old a'], [`config/${bBackup.path}`, 'old b'],
  ]);
  const uploads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      uploads.push(((init.body as FormData).get('file') as { name?: string } | null)?.name ?? 'unknown');
      return { ok: true };
    }
    const path = decodeURIComponent(new URL(url).pathname.replace('/server/files/', ''));
    return { ok: contents.has(path), status: 404, text: async () => contents.get(path) ?? '' };
  }));
  const request = vi.fn(async (method: string) => method === 'printer.info' ? { state: 'ready' } : {});
  const target = { httpBaseUrl: 'http://printer', authToken: null, request,
    onNotify: () => () => {}, subscribe: () => () => {} } as unknown as MoonrakerProxyHandle;
  const api = { moonrakerFor: () => target, printer: { id: printerId } } as unknown as PluginApi;
  return { api, target, request, uploads };
}

afterEach(() => vi.unstubAllGlobals());

describe('multi-file restart recovery', () => {
  it('restores both snapshots and sends one restart', async () => {
    const fixture = recoveryFixture('multi-restore');
    expect(await restoreConfigAttempt(fixture.api, 'multi-restore', 'multi')).toBe('restored');
    expect(fixture.uploads).toEqual(['a.cfg', 'b.cfg']);
    expect(fixture.request).toHaveBeenCalledWith('printer.firmware_restart', {});
    const monitor = configRestartMonitor('multi-restore', fixture.target);
    expect(monitor.current()?.phase).toBe('checking');
    monitor.dismiss();
  });

  it('checks every file for later edits before restoring any', async () => {
    const fixture = recoveryFixture('multi-conflict', true);
    expect(await restoreConfigAttempt(fixture.api, 'multi-conflict', 'multi')).toBe('conflict');
    expect(fixture.uploads).toEqual([]);
  });
});
