import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoonrakerProxyHandle } from '../../../../plugin-sdk/src/types';
import { ConfigRestartMonitor, advanceRestartAttempt, configFingerprint, type RestartAttempt } from '../config-restart-monitor';
import { restartAttemptBackupRef } from '../file-ops';

const file = { root: 'config', path: 'macros/home.cfg', isDir: false };

/** Drive the monitor with the same Moonraker event kinds used in production. */
function fakeTarget() {
  const notifications = new Map<string, () => void>();
  let snapshot: ((delta: unknown) => void) | null = null;
  let currentState = 'ready';
  const target = {
    onNotify: vi.fn((event: string, callback: () => void) => {
      notifications.set(event, callback);
      return () => notifications.delete(event);
    }),
    subscribe: vi.fn((_objects: unknown, callback: (delta: unknown) => void) => {
      snapshot = callback;
      callback({ webhooks: { state: 'ready' } });
      return () => { snapshot = null; };
    }),
    request: vi.fn(async () => ({ state: currentState })),
  } as unknown as MoonrakerProxyHandle;
  return {
    target,
    notify: (event: string) => {
      if (event === 'notify_klippy_started') currentState = 'startup';
      if (event === 'notify_klippy_ready') currentState = 'ready';
      notifications.get(event)?.();
    },
    state: (state: string) => { currentState = state; snapshot?.({ webhooks: { state } }); },
  };
}

let session = new Map<string, string>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  session = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => { session.set(key, value); },
    removeItem: (key: string) => { session.delete(key); },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Config restart monitor', () => {
  it('requires observed startup and a later ready before the deadline', () => {
    const events = fakeTarget();
    const monitor = new ConfigRestartMonitor('p1', events.target);
    monitor.start('one', file, null, 'new config');
    events.state('ready');
    expect(monitor.current()?.phase).toBe('checking');
    events.notify('notify_klippy_started');
    expect(monitor.current()?.observedStartup).toBe(true);
    events.notify('notify_klippy_ready');
    expect(monitor.current()?.phase).toBe('ready');
  });

  it('distinguishes an unconfirmed command from a startup that failed', async () => {
    const events = fakeTarget();
    const monitor = new ConfigRestartMonitor('p1', events.target);
    monitor.start('one', file, null, 'new');
    await vi.advanceTimersByTimeAsync(100_000);
    expect(monitor.current()?.phase).toBe('unconfirmed');
    events.notify('notify_klippy_started');
    events.notify('notify_klippy_ready');
    expect(monitor.current()?.phase).toBe('unconfirmed');
    monitor.start('two', file, file, 'newer');
    events.state('startup');
    await vi.advanceTimersByTimeAsync(100_000);
    expect(monitor.current()?.phase).toBe('failed');
    events.state('ready');
    expect(monitor.current()?.phase).toBe('failed');
  });

  it('survives a reload and keeps attempts isolated by printer', () => {
    const first = fakeTarget();
    const monitor = new ConfigRestartMonitor('p1', first.target);
    // Persisted attempts require the copy path derived from their exact attempt ID.
    monitor.start('one', file, restartAttemptBackupRef(file, 'one'), 'new');
    first.state('startup');
    const restored = new ConfigRestartMonitor('p1', fakeTarget().target);
    expect(restored.current()?.observedStartup).toBe(true);
    expect(restored.current()?.deadline).toBe(monitor.current()?.deadline);
    expect(new ConfigRestartMonitor('p2', fakeTarget().target).current()).toBeNull();
  });

  it('persists every file in a shared restart attempt', () => {
    const second = { root: 'config', path: 'macros/other.cfg', isDir: false };
    const monitor = new ConfigRestartMonitor('p3', fakeTarget().target);
    monitor.start('multi', file, restartAttemptBackupRef(file, 'multi'), 'new home', [
      { file, backup: restartAttemptBackupRef(file, 'multi'), text: 'new home' },
      { file: second, backup: restartAttemptBackupRef(second, 'multi'), text: 'new other' },
    ]);
    const restored = new ConfigRestartMonitor('p3', fakeTarget().target);
    expect(restored.current()?.files).toMatchObject([
      { file, writtenFingerprint: configFingerprint('new home') },
      { file: second, writtenFingerprint: configFingerprint('new other') },
    ]);
  });

  it('replaces a previous attempt and ignores its late command error', () => {
    const monitor = new ConfigRestartMonitor('p1', fakeTarget().target);
    monitor.start('one', file, file, 'old');
    monitor.start('two', file, null, 'new');
    monitor.commandFailed('one', new Error('late rejection'));
    expect(monitor.current()?.phase).toBe('checking');
    monitor.commandFailed('two', new Error('denied'));
    expect(monitor.current()).toMatchObject({ phase: 'commandError', commandError: 'denied' });
  });

  it('marks a ready event after the deadline as failed even if the interval has not ticked', () => {
    const attempt: RestartAttempt = {
      id: 'one', printerId: 'p1', file, backup: file, writtenFingerprint: configFingerprint('new'),
      deadline: 100_000, observedStartup: true, phase: 'checking',
    };
    expect(advanceRestartAttempt(attempt, 'ready', 100_000).phase).toBe('failed');
    expect(configFingerprint('changed')).not.toBe(configFingerprint('new'));
  });
});
