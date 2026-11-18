import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import type { KlippyState } from '../klippy-state/use-klippy-state.svelte.ts';
import { readConfigRestartState, type FileRef } from './file-ops';

/** The editor owns one mutable buffer and saved baseline per open config file. */
export interface ConfigEditorTab {
  ref: FileRef;
  content: string;
  saved: string;
}

/** Only the backup-first operations are needed by tab management. */
export interface ConfigTabWrites {
  saveConfigText(ref: FileRef, content: string, target: MoonrakerProxyHandle): Promise<void>;
  createRestartAttemptBackup(ref: FileRef, attemptId: string, target: MoonrakerProxyHandle): Promise<FileRef>;
}

/** A saved file and its separate restart snapshot can be restored together after failure. */
export interface RestartSavedFile {
  file: FileRef;
  backup: FileRef | null;
  text: string;
}

/**
 * Close one tab after the caller has obtained the user's save or discard decision.
 * @param tabs Current independent file buffers.
 * @param path Exact tab path to close.
 * @param saveChanges Whether to write that tab before removal.
 * @param target Printer-bound Moonraker connection.
 * @param writes Backup-first file operations.
 * @returns Remaining tabs, the neighbor to activate, and whether the tab actually closed.
 */
export async function closeConfigEditorTab<T extends ConfigEditorTab>(
  tabs: readonly T[], path: string, saveChanges: boolean, target: MoonrakerProxyHandle, writes: ConfigTabWrites,
): Promise<{ remaining: T[]; nextPath: string | null; closed: boolean }> {
  const index = tabs.findIndex((tab) => tab.ref.path === path);
  if (index < 0) return { remaining: [...tabs], nextPath: null, closed: false };
  const tab = tabs[index]!;
  if (saveChanges && tab.content !== tab.saved) {
    const submitted = tab.content;
    await writes.saveConfigText(tab.ref, submitted, target);
    tab.saved = submitted;
    // A newer edit must not disappear just because the earlier upload completed.
    if (tab.content !== submitted) return { remaining: [...tabs], nextPath: null, closed: false };
  }
  const remaining = tabs.filter((item) => item !== tab);
  return { remaining, nextPath: remaining[Math.min(index, remaining.length - 1)]?.ref.path ?? null, closed: true };
}

/**
 * Snapshot every dirty cfg before writing, then save all and permit one restart.
 * @param tabs Current independent file buffers.
 * @param preferredPath Active tab path, preferred as the recovery anchor.
 * @param attemptId Unique restart backup suffix.
 * @param target Printer-bound Moonraker connection.
 * @param writes Backup-first file operations.
 * @returns Saved file details, verified state, and whether newer edits appeared during uploads.
 */
export async function saveConfigTabsForRestart<T extends ConfigEditorTab>(
  tabs: readonly T[], preferredPath: string, attemptId: string,
  target: MoonrakerProxyHandle, writes: ConfigTabWrites,
): Promise<{ state: KlippyState; files: RestartSavedFile[]; changedDuringSave: boolean } | null> {
  const pending = tabs.filter((tab) => tab.content !== tab.saved).map((tab) => ({ tab, text: tab.content }));
  if (!pending.length) return null;
  const state = await readConfigRestartState(target);
  const preferred = pending.findIndex(({ tab }) => tab.ref.path === preferredPath);
  if (preferred > 0) pending.unshift(...pending.splice(preferred, 1));
  const files: RestartSavedFile[] = [];
  // All attempt snapshots precede uploads so a failed snapshot cannot leave mixed files on disk.
  for (const { tab, text } of pending) {
    const backup = state === 'ready'
      ? await writes.createRestartAttemptBackup(tab.ref, attemptId, target) : null;
    files.push({ file: tab.ref, backup, text });
  }
  for (const { tab, text } of pending) {
    await writes.saveConfigText(tab.ref, text, target);
    // A concurrent edit remains dirty because only the submitted version becomes the baseline.
    tab.saved = text;
  }
  return { state, files, changedDuringSave: pending.some(({ tab, text }) => tab.content !== text) };
}
