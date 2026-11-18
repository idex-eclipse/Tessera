import type { PluginApi } from '../../../plugin-sdk/src/types';
import type { EditorState } from '@codemirror/state';
import { fileCap } from '../../shared/file-table/file-capabilities';
import { configBackupRef, createFileOps, readConfigRestartState, type FileRef } from '../../shared/file-table/file-ops';
import type { RestartSavedFile } from '../../shared/file-table/config-editor-tabs';
import { dispatchConfigRestart } from '../../shared/file-table/config-restart-command';
import { configRestartMonitor, newRestartAttemptId } from '../../shared/file-table/config-restart-monitor';
import type { KlippyState } from '../../shared/klippy-state/use-klippy-state.svelte.ts';
import { notifyMoonrakerRestartError, notifyMoonrakerRestartNeeded } from '../notifications';

type EditorSnapshot = ReturnType<EditorState['toJSON']>;

/** One file's in-memory contents belong to its printer, even while another printer is active. */
export interface ConfigSessionTab {
  id: string;
  ref: FileRef;
  kind: 'text' | 'image';
  content: string;
  saved: string;
  readonly: boolean;
  loading: boolean;
  snapshot?: EditorSnapshot;
  compareInitially?: boolean;
  attemptBackup?: FileRef | null;
  jumpLine?: number;
}

/** The overlay and banner share this state; page unmounting never owns a buffer. */
export interface ConfigEditorSession {
  tabs: ConfigSessionTab[];
  activeId: string | null;
  expanded: boolean;
  busy: boolean;
  closePrompt: boolean;
  tabCloseId: string | null;
  error: string | null;
  /** A partial save still needs its original copies and eventual restart. */
  restartAttempt?: {
    id: string;
    state: KlippyState;
    backups: Record<string, FileRef | null>;
    files: RestartSavedFile[];
  };
  moonrakerRestartPending: boolean;
}

export const editorSessions = $state<Record<string, ConfigEditorSession>>({});

// Reading a session from a Svelte derived value must never write reactive state.
const emptySession: ConfigEditorSession = {
  tabs: [], activeId: null, expanded: false, busy: false,
  closePrompt: false, tabCloseId: null, error: null, moonrakerRestartPending: false,
};

/** Guard reasons and known Config failures are localization keys, not raw UI text. */
function sessionErrorText(api: PluginApi, error: unknown): string {
  const reasonKey = (error as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
  if (reasonKey) return api.i18n.t(reasonKey);
  if (error instanceof Error && ['config.backupInvalid', 'config.restartStateError'].includes(error.message))
    return api.i18n.t(error.message);
  return error instanceof Error ? error.message : String(error);
}

/** Return the printer's session without changing reactive state during rendering. */
export function editorSession(printerId: string): ConfigEditorSession {
  return editorSessions[printerId] ?? emptySession;
}

/** Create a session only from a user action, outside derived values and templates. */
function ensureEditorSession(printerId: string): ConfigEditorSession {
  const existing = editorSessions[printerId];
  if (existing) return existing;
  editorSessions[printerId] = {
    tabs: [], activeId: null, expanded: false, busy: false,
    closePrompt: false, tabCloseId: null, error: null, moonrakerRestartPending: false,
  };
  // Return the proxied entry, so later async read results update mounted surfaces.
  return editorSessions[printerId]!;
}

/** Root and path both matter: two Moonraker roots may contain the same filename. */
export function sessionTabId(ref: FileRef): string {
  return `${ref.root}/${ref.path}`;
}

/** Preserve an existing buffer when a file is opened again from a table or recovery panel. */
export async function openConfigSessionFile(api: PluginApi, ref: FileRef, options: {
  compare?: boolean; attemptBackup?: FileRef | null; line?: number;
} = {}): Promise<void> {
  const printerId = api.printer.id;
  const session = ensureEditorSession(printerId);
  const id = sessionTabId(ref);
  const existing = session.tabs.find((tab) => tab.id === id);
  if (existing) {
    existing.compareInitially = options.compare ?? existing.compareInitially;
    existing.attemptBackup = options.attemptBackup ?? existing.attemptBackup;
    existing.jumpLine = options.line ?? 0;
    session.activeId = id;
    session.expanded = true;
    return;
  }
  const cap = fileCap(api, ref.path.split('/').pop() ?? '', ref.root);
  const initialTab: ConfigSessionTab = {
    id, ref, kind: cap.mode === 'view' ? 'image' : 'text', content: '', saved: '',
    readonly: cap.readonly || (ref.root === 'config' && /\.(cfg|conf)\.bak$/i.test(ref.path)),
    loading: cap.mode !== 'view', compareInitially: options.compare,
    attemptBackup: options.attemptBackup, jumpLine: options.line ?? 0,
  };
  session.tabs.push(initialTab);
  // Use the proxied tab for the asynchronous read, so loading and contents stay reactive.
  const tab = session.tabs.at(-1)!;
  session.activeId = id;
  session.expanded = true;
  session.error = null;
  if (tab.kind === 'image') return;
  try {
    // The captured handle prevents an in-flight read from switching to another printer.
    const text = await createFileOps(api).readText(ref, api.moonrakerFor(printerId));
    tab.content = text.replace(/\r\n?/g, '\n');
    tab.saved = tab.content;
  } catch (error) {
    session.tabs = session.tabs.filter((item) => item !== tab);
    if (session.activeId === id) session.activeId = session.tabs.at(-1)?.id ?? null;
    session.expanded = session.tabs.length > 0 && session.expanded;
    session.error = sessionErrorText(api, error);
  } finally {
    tab.loading = false;
  }
}

/** Select a retained tab and reveal its editor or image viewer. */
export function selectConfigSessionTab(printerId: string, id: string, line = 0): void {
  const session = editorSessions[printerId];
  if (!session) return;
  const tab = session.tabs.find((item) => item.id === id);
  if (!tab) return;
  tab.jumpLine = line;
  session.activeId = id;
  session.expanded = true;
}

/** Closing the session is safe only after the caller has settled dirty buffers. */
export function clearConfigSession(printerId: string): void {
  const session = editorSessions[printerId];
  if (!session) return;
  session.tabs = [];
  session.activeId = null;
  session.expanded = false;
  session.closePrompt = false;
  session.tabCloseId = null;
  session.error = null;
  session.restartAttempt = undefined;
  session.moonrakerRestartPending = false;
}

/** A close request from either surface follows the same dirty-file policy. */
export function requestConfigSessionClose(printerId: string): void {
  const session = editorSessions[printerId];
  if (!session) return;
  if (session.busy) return;
  if (session.tabs.some((tab) => tab.content !== tab.saved) ||
    session.restartAttempt?.files.length || session.moonrakerRestartPending) session.closePrompt = true;
  else clearConfigSession(printerId);
}

/** Ask before dropping one dirty tab; clean tabs can be removed immediately. */
export function requestConfigSessionTabClose(printerId: string, id: string): void {
  const session = editorSessions[printerId];
  if (!session) return;
  const tab = session.tabs.find((item) => item.id === id);
  if (!tab || session.busy) return;
  if (tab.content !== tab.saved) { session.tabCloseId = id; return; }
  const index = session.tabs.indexOf(tab);
  session.tabs.splice(index, 1);
  if (session.activeId === id) session.activeId = session.tabs[Math.min(index, session.tabs.length - 1)]?.id ?? null;
  if (!session.tabs.length) session.expanded = false;
}

function klipperConfig(tab: ConfigSessionTab): boolean {
  return tab.ref.root === 'config' && /\.(cfg|conf)$/i.test(tab.ref.path) && !/^moonraker\.conf$/i.test(tab.ref.path);
}

function moonrakerConfig(tab: ConfigSessionTab): boolean {
  return tab.ref.root === 'config' && /^moonraker\.conf$/i.test(tab.ref.path);
}

/** Save one tab through the normal backup path without losing edits made during upload. */
export async function saveConfigSessionTab(api: PluginApi, printerId: string, id: string): Promise<boolean> {
  const session = editorSessions[printerId];
  if (!session) return false;
  const tab = session.tabs.find((item) => item.id === id);
  if (!tab || tab.kind !== 'text' || tab.readonly || session.busy) return false;
  if (tab.content === tab.saved) return true;
  session.busy = true;
  const submitted = tab.content;
  try {
    const ops = createFileOps(api);
    const target = api.moonrakerFor(printerId);
    if (configBackupRef(tab.ref)) await ops.saveConfigText(tab.ref, submitted, target);
    else await ops.saveText(tab.ref, submitted, target);
    tab.saved = submitted;
    session.error = null;
    return tab.content === submitted;
  } catch (error) {
    session.error = sessionErrorText(api, error);
    return false;
  } finally {
    session.busy = false;
  }
}

/** Remove one file only after its selected save succeeds and no newer edit remains. */
export async function closeConfigSessionTab(api: PluginApi, printerId: string, id: string, saveChanges: boolean): Promise<boolean> {
  const session = editorSessions[printerId];
  if (!session) return false;
  const tab = session.tabs.find((item) => item.id === id);
  if (!tab || session.busy) return false;
  if (saveChanges && tab.content !== tab.saved && !(await saveConfigSessionTab(api, printerId, id))) return false;
  const index = session.tabs.indexOf(tab);
  if (index < 0) return false;
  session.tabs.splice(index, 1);
  if (session.activeId === id) session.activeId = session.tabs[Math.min(index, session.tabs.length - 1)]?.id ?? null;
  if (!session.tabs.length) session.expanded = false;
  session.tabCloseId = null;
  return true;
}

/** Save all changed files, then dispatch only the restart required by changed config files. */
export async function saveAllConfigSession(api: PluginApi, printerId: string): Promise<boolean> {
  const session = editorSessions[printerId];
  if (!session) return false;
  if (session.busy || session.tabs.some((tab) => tab.loading)) return false;
  const pending = session.tabs.filter((tab) => tab.kind === 'text' && tab.content !== tab.saved);
  if (pending.some((tab) => tab.readonly)) return false;
  const klipperTabs = pending.filter(klipperConfig);
  const moonrakerTabs = pending.filter(moonrakerConfig);
  const target = api.moonrakerFor(printerId);
  const ops = createFileOps(api);
  session.busy = true;
  try {
    // An incomplete batch keeps its original attempt copies until all files are saved.
    let attempt = session.restartAttempt;
    if (klipperTabs.length || attempt) {
      const state = await readConfigRestartState(target);
      if (!attempt) {
        attempt = { id: newRestartAttemptId(), state, backups: {}, files: [] };
        session.restartAttempt = attempt;
        attempt = session.restartAttempt;
      }
      attempt.state = state;
      // Make every new attempt copy before the first upload in this batch.
      try {
        for (const tab of klipperTabs) {
          if (Object.hasOwn(attempt.backups, tab.id)) continue;
          attempt.backups[tab.id] = state === 'ready'
            ? await ops.createRestartAttemptBackup(tab.ref, attempt.id, target) : null;
        }
      } catch (error) {
        if (!attempt.files.length) session.restartAttempt = undefined;
        throw error;
      }
      for (const tab of klipperTabs) {
        const submitted = tab.content;
        await ops.saveConfigText(tab.ref, submitted, target);
        tab.saved = submitted;
        const existing = attempt.files.find((file) => file.file.path === tab.ref.path);
        if (existing) existing.text = submitted;
        else attempt.files.push({ file: tab.ref, backup: attempt.backups[tab.id] ?? null, text: submitted });
      }
    }
    for (const tab of pending.filter((item) => !klipperConfig(item))) {
      const submitted = tab.content;
      if (configBackupRef(tab.ref)) await ops.saveConfigText(tab.ref, submitted, target);
      else await ops.saveText(tab.ref, submitted, target);
      tab.saved = submitted;
      if (moonrakerConfig(tab)) session.moonrakerRestartPending = true;
    }
    if (session.tabs.some((tab) => tab.content !== tab.saved)) {
      session.error = api.i18n.t('config.restartEditedDuringSave');
      return false;
    }
    session.error = null;
    if (attempt?.files.length) {
      const primary = attempt.files[0]!;
      const monitor = configRestartMonitor(printerId, target);
      monitor.start(attempt.id, primary.file, primary.backup, primary.text, attempt.files);
      dispatchConfigRestart(target, primary.file, attempt.state, (error) => monitor.commandFailed(attempt.id, error));
      if (session.moonrakerRestartPending) notifyMoonrakerRestartNeeded(api, printerId);
    } else if (session.moonrakerRestartPending) {
      // Moonraker may disconnect before acknowledging its own service restart.
      dispatchConfigRestart(target, refForMoonraker(session.tabs, moonrakerTabs), 'unknown', (error) => {
        notifyMoonrakerRestartError(api, printerId, error);
      });
    }
    clearConfigSession(printerId);
    return true;
  } catch (error) {
    session.error = sessionErrorText(api, error);
    return false;
  } finally {
    session.busy = false;
  }
}

/** A previously saved moonraker.conf can be clean by the time a retry dispatches its restart. */
function refForMoonraker(tabs: ConfigSessionTab[], pending: ConfigSessionTab[]): FileRef {
  return (pending.find(moonrakerConfig) ?? tabs.find(moonrakerConfig))?.ref
    ?? { root: 'config', path: 'moonraker.conf', isDir: false };
}
