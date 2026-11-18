import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import { restartAttemptBackupRef, type FileRef } from './file-ops';

/** The monitor stores only one actionable restart attempt per printer and browser tab. */
export interface RestartAttempt {
  id: string;
  printerId: string;
  file: FileRef;
  backup: FileRef | null;
  writtenFingerprint: string;
  /** Every file saved by one restart, including the primary file kept above for older sessions. */
  files?: Array<{ file: FileRef; backup: FileRef | null; writtenFingerprint: string }>;
  deadline: number;
  observedStartup: boolean;
  notified?: boolean;
  phase: 'checking' | 'ready' | 'unconfirmed' | 'failed' | 'commandError';
  commandError?: string;
}

const DURATION_MS = 100_000;
const STORAGE_PREFIX = 'tessera:config-restart:';

/**
 * Identify the uploaded version without storing a potentially large config in sessionStorage.
 * @param text Saved config content.
 * @returns An advisory fingerprint for detecting later edits before recovery.
 */
export function configFingerprint(text: string): string {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 2246822519);
  }
  return `${text.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

/** @returns A path-safe ID that keeps successive restart copies separate. */
export function newRestartAttemptId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Apply only observed post-command Klipper states; a pre-existing ready is not success.
 * @param attempt Current persisted check.
 * @param state Newly observed Klipper state, or null for a deadline tick.
 * @param now Current wall-clock timestamp in milliseconds.
 * @returns Updated attempt or the unchanged input when no transition occurred.
 */
export function advanceRestartAttempt(attempt: RestartAttempt, state: string | null, now: number): RestartAttempt {
  if (attempt.phase !== 'checking') return attempt;
  if (now >= attempt.deadline) {
    return { ...attempt, phase: attempt.observedStartup ? 'failed' : 'unconfirmed' };
  }
  if (state === 'startup') return { ...attempt, observedStartup: true };
  if (state === 'ready' && attempt.observedStartup) return { ...attempt, phase: 'ready' };
  return attempt;
}

function persisted(printerId: string): RestartAttempt | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${printerId}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const attempt = value as RestartAttempt;
    const expectedBackup = typeof attempt.id === 'string' ? restartAttemptBackupRef(attempt.file, attempt.id) : null;
    const validFiles = attempt.files === undefined || (Array.isArray(attempt.files) && attempt.files.length > 0 &&
      attempt.files[0]?.file?.path === attempt.file?.path &&
      attempt.files[0]?.backup?.path === attempt.backup?.path &&
      attempt.files[0]?.writtenFingerprint === attempt.writtenFingerprint &&
      attempt.files.every((entry) => {
        const expected = restartAttemptBackupRef(entry.file, attempt.id);
        return entry.file?.root === 'config' && typeof entry.file.path === 'string' &&
          typeof entry.writtenFingerprint === 'string' &&
          (entry.backup === null || (entry.backup?.root === 'config' && entry.backup.path === expected?.path));
      }));
    return attempt.printerId === printerId && typeof attempt.id === 'string'
      && attempt.file?.root === 'config' && typeof attempt.file.path === 'string'
      && typeof attempt.deadline === 'number' && typeof attempt.writtenFingerprint === 'string'
      && (attempt.backup === null || (attempt.backup?.root === 'config' && attempt.backup.path === expectedBackup?.path))
      && validFiles && ['checking', 'ready', 'unconfirmed', 'failed', 'commandError'].includes(attempt.phase)
      ? attempt : null;
  } catch {
    return null;
  }
}

/** Keep the active check alive when the Config editor or page is unmounted. */
export class ConfigRestartMonitor {
  private attempt: RestartAttempt | null;
  private listeners = new Set<(attempt: RestartAttempt | null) => void>();
  private unsubs: Array<() => void> = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private printerId: string, private target: MoonrakerProxyHandle) {
    this.attempt = persisted(printerId);
    this.tick();
    this.watch();
  }

  /** Subscribe to the latest status for the currently selected printer. */
  subscribe(listener: (attempt: RestartAttempt | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.attempt);
    return () => this.listeners.delete(listener);
  }

  /** Return the current attempt for command callbacks and recovery checks. */
  current(): RestartAttempt | null {
    return this.attempt;
  }

  /** Begin a new 100-second check just before dispatching the restart command. */
  start(id: string, file: FileRef, backup: FileRef | null, writtenText: string,
    files: ReadonlyArray<{ file: FileRef; backup: FileRef | null; text: string }> = [{ file, backup, text: writtenText }]): void {
    this.stopWatching();
    this.set({
      id, printerId: this.printerId, file, backup,
      writtenFingerprint: configFingerprint(writtenText),
      files: files.map((entry) => ({ file: entry.file, backup: entry.backup,
        writtenFingerprint: configFingerprint(entry.text) })),
      deadline: Date.now() + DURATION_MS, observedStartup: false, phase: 'checking',
    });
    this.watch();
  }

  /** Record an explicit Moonraker rejection without claiming that Klipper has recovered. */
  commandFailed(id: string, error: unknown): void {
    if (this.attempt?.id !== id || this.attempt.phase === 'ready') return;
    this.set({ ...this.attempt, phase: 'commandError', commandError: error instanceof Error ? error.message : String(error) });
    this.stopWatching();
  }

  /** Persist delivery before publishing so remounted overlays do not duplicate a failure toast. */
  markNotified(id: string): void {
    if (this.attempt?.id === id && !this.attempt.notified) this.set({ ...this.attempt, notified: true });
  }

  /** Remove a resolved message after the user has seen it. */
  dismiss(): void {
    this.set(null);
    this.stopWatching();
  }

  private set(attempt: RestartAttempt | null): void {
    this.attempt = attempt;
    try {
      if (attempt) sessionStorage.setItem(`${STORAGE_PREFIX}${this.printerId}`, JSON.stringify(attempt));
      else sessionStorage.removeItem(`${STORAGE_PREFIX}${this.printerId}`);
    } catch {
      // The in-memory check remains useful when the browser denies session storage.
    }
    for (const listener of this.listeners) listener(attempt);
  }

  private observe(state: string): void {
    if (!this.attempt) return;
    const next = advanceRestartAttempt(this.attempt, state, Date.now());
    if (next !== this.attempt) this.set(next);
    if (next.phase !== 'checking') this.stopWatching();
  }

  private tick(): void {
    if (!this.attempt) return;
    const next = advanceRestartAttempt(this.attempt, null, Date.now());
    if (next !== this.attempt) this.set(next);
    if (next.phase !== 'checking') this.stopWatching();
  }

  private watch(): void {
    if (this.attempt?.phase !== 'checking' || this.interval) return;
    this.unsubs = [
      this.target.onNotify('notify_klippy_started', () => this.observe('startup')),
      this.target.onNotify('notify_klippy_ready', () => this.observe('ready')),
      this.target.subscribe({ webhooks: ['state'] }, (delta: unknown) => {
        const state = (delta as { webhooks?: { state?: unknown } })?.webhooks?.state;
        if (typeof state === 'string') this.observe(state);
      }, { immediate: true }),
    ];
    this.interval = setInterval(() => {
      this.tick();
      if (this.attempt?.phase !== 'checking') return;
      const id = this.attempt.id;
      // Polling catches state changes that arrive while the websocket reconnects.
      void this.target.request<{ state?: string }>('printer.info').then((info) => {
        if (this.attempt?.id === id && typeof info?.state === 'string') this.observe(info.state);
      }).catch(() => {});
    }, 1500);
    // A one-shot deadline prevents an extra polling interval of apparent time remaining.
    this.deadlineTimer = setTimeout(() => this.tick(), Math.max(0, this.attempt.deadline - Date.now()));
  }

  private stopWatching(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }
}

const monitors = new Map<string, ConfigRestartMonitor>();

/**
 * Reuse the printer-specific monitor across editor and page mounts.
 * @param printerId Stable owner ID for the pending attempt.
 * @param target Moonraker handle bound to that printer.
 * @returns The retained monitor for this browser tab and printer.
 */
export function configRestartMonitor(printerId: string, target: MoonrakerProxyHandle): ConfigRestartMonitor {
  let monitor = monitors.get(printerId);
  if (!monitor) {
    monitor = new ConfigRestartMonitor(printerId, target);
    monitors.set(printerId, monitor);
  }
  return monitor;
}
