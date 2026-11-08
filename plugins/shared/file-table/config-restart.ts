import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

/** A confirmed restart is reported without changing the retained backup. */
export type RestartOutcome = 'ready' | 'error' | 'timeout' | 'rejected';

/**
 * Observe the new lifecycle before accepting a ready response: printer.info may still contain
 * the pre-restart snapshot immediately after the restart command is sent.
 */
export async function checkConfigRestart(
  handle: MoonrakerProxyHandle,
  kind: 'klipper' | 'moonraker',
  restart: () => Promise<unknown>,
  timeoutMs = 100_000,
): Promise<RestartOutcome> {
  return new Promise((resolve) => {
    let finished = false;
    let changed = false;
    let started = false;
    let checking = false;
    const cleanup: Array<() => void> = [];
    const finish = (result: RestartOutcome) => {
      if (finished) return;
      finished = true;
      for (const stop of cleanup) stop();
      resolve(result);
    };

    const check = async () => {
      if (finished || !changed || checking || handle.readyState !== 'open') return;
      checking = true;
      try {
        if (kind === 'moonraker') {
          await handle.request('server.info');
          finish('ready');
        } else {
          const info = await handle.request<{ state?: string }>('printer.info');
          if (info.state === 'ready') finish('ready');
          else if (info.state === 'error' || (started && info.state === 'shutdown')) finish('error');
        }
      } catch {
        // A transient disconnect during restart is expected; the deadline bounds retries.
      } finally {
        checking = false;
      }
    };

    cleanup.push(handle.onConnectionStatusChange((status) => {
      if (status === 'closed' && kind === 'moonraker') changed = true;
      if (status === 'open') void check();
    }));
    if (kind === 'klipper') {
      cleanup.push(handle.onNotify('notify_klippy_started', () => {
        changed = true;
        started = true;
        void check();
      }));
      cleanup.push(handle.onNotify('notify_klippy_disconnected', () => {
        changed = true;
        void check();
      }));
      cleanup.push(handle.onNotify('notify_klippy_shutdown', () => {
        // Shutdown before the new startup can be part of a normal firmware restart.
        if (changed) void check();
      }));
      cleanup.push(handle.onNotify('notify_klippy_ready', () => {
        if (changed) void check();
      }));
    }
    const poll = setInterval(() => void check(), 1500);
    cleanup.push(() => clearInterval(poll));
    const deadline = setTimeout(() => finish('timeout'), timeoutMs);
    cleanup.push(() => clearTimeout(deadline));

    void restart().catch(() => {
      // A transport rejection is normal after a restart; a request rejected before any
      // lifecycle signal is reported, leaving the backup available for inspection.
      if (!changed) finish('rejected');
    });
  });
}
