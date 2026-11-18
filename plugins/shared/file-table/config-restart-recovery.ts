import type { PluginApi } from '../../../plugin-sdk/src/types';
import type { KlippyState } from '../klippy-state/use-klippy-state.svelte.ts';
import { dispatchConfigRestart } from './config-restart-command';
import { configFingerprint, configRestartMonitor, newRestartAttemptId } from './config-restart-monitor';
import { createFileOps } from './file-ops';

/** Recovery can be triggered from both the Config table and a persistent notification action. */
export type RestoreOutcome = 'restored' | 'conflict' | 'unavailable' | 'busy';

const restoring = new Set<string>();

/**
 * Restore every file saved by the failed attempt, saving deployed versions to .bak first.
 * @param api Config plugin API with printer-bound Moonraker access.
 * @param printerId Printer that owns the attempt.
 * @param attemptId Exact attempt from the notification or table.
 * @param overwrite Whether the user has confirmed overwriting later edits.
 * @returns The recovery outcome; a conflict never writes anything.
 */
export async function restoreConfigAttempt(api: PluginApi, printerId: string, attemptId: string, overwrite = false): Promise<RestoreOutcome> {
  const key = `${printerId}:${attemptId}`;
  if (restoring.has(key)) return 'busy';
  restoring.add(key);
  try {
    const target = api.moonrakerFor(printerId);
    const monitor = configRestartMonitor(printerId, target);
    const attempt = monitor.current();
    if (!attempt?.backup || attempt.id !== attemptId || attempt.phase !== 'failed') return 'unavailable';
    const ops = createFileOps(api);
    const files = attempt.files ?? [{ file: attempt.file, backup: attempt.backup,
      writtenFingerprint: attempt.writtenFingerprint }];
    if (files.some((entry) => !entry.backup)) return 'unavailable';
    // Check every deployed version before writing any restore, then read all snapshots.
    for (const entry of files) {
      const current = await ops.readText(entry.file, target);
      if (configFingerprint(current) !== entry.writtenFingerprint && !overwrite) return 'conflict';
    }
    const originals = await Promise.all(files.map(async (entry) => ops.readText(entry.backup!, target)));
    // A new save may replace the active attempt while the backup is being read.
    if (monitor.current()?.id !== attemptId) return 'unavailable';
    for (const [index, entry] of files.entries()) await ops.saveConfigText(entry.file, originals[index]!, target);
    const info = await target.request<{ state?: KlippyState }>('printer.info').catch(() => null);
    const state = info?.state ?? 'unknown';
    const nextId = newRestartAttemptId();
    monitor.start(nextId, attempt.file, null, originals[0]!);
    dispatchConfigRestart(target, attempt.file, state, (error) => monitor.commandFailed(nextId, error));
    return 'restored';
  } finally {
    restoring.delete(key);
  }
}
