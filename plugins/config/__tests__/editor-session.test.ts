import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginApi } from '../../../plugin-sdk/src/types';
import type { FileRef } from '../../shared/file-table/file-ops';
import {
  closeConfigSessionTab, editorSession, editorSessions, openConfigSessionFile,
  requestConfigSessionClose, requestConfigSessionTabClose, saveAllConfigSession,
  selectConfigSessionTab, sessionTabId,
} from '../state/editor-session.svelte';

const restart = vi.hoisted(() => ({ dispatch: vi.fn(), start: vi.fn(), failed: vi.fn() }));
vi.mock('../../shared/file-table/config-restart-command', () => ({ dispatchConfigRestart: restart.dispatch }));
vi.mock('../../shared/file-table/config-restart-monitor', () => ({
  newRestartAttemptId: () => 'attempt-one',
  configRestartMonitor: () => ({ start: restart.start, commandFailed: restart.failed }),
}));

const ref = (root: string, path: string): FileRef => ({ root, path, isDir: false });

/** A fake Moonraker handle records service calls while fetch handles file bytes. */
function fixture() {
  const files = new Map<string, string>([
    ['config/a.cfg', 'old config'], ['config/b.cfg', 'old second config'],
    ['config/moonraker.conf', 'old moonraker'],
    ['config/notes.txt', 'old notes'], ['docs/notes.txt', 'readonly notes'],
    ['logs/klippy.log', 'log text'],
  ]);
  const requests: string[] = [];
  const notices: unknown[] = [];
  let printerId = 'p1';
  let failUpload = '';
  let duringUpload: (() => void) | null = null;
  const target = {
    httpBaseUrl: 'http://localhost', authToken: null,
    request: vi.fn(async (method: string) => {
      requests.push(method);
      return method === 'printer.info' ? { state: 'ready' } : {};
    }),
  };
  const api = {
    get printer() { return { id: printerId }; },
    moonrakerFor: () => target,
    settingsFor: () => ({ get: () => undefined }),
    i18n: { t: (key: string) => key },
    notifications: { push: (item: unknown) => notices.push(item) },
  } as unknown as PluginApi;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const form = init.body as FormData;
      const root = String(form.get('root'));
      const path = String(form.get('path') ?? '');
      const uploaded = form.get('file') as File;
      const key = `${root}/${path ? `${path}/` : ''}${uploaded.name}`;
      if (key === failUpload) return new Response('', { status: 500 });
      files.set(key, await uploaded.text());
      duringUpload?.();
      return new Response('', { status: 200 });
    }
    const path = new URL(input).pathname.replace('/server/files/', '');
    return new Response(files.get(path) ?? '', { status: files.has(path) ? 200 : 404 });
  }));
  return {
    api, files, requests, notices,
    setPrinter: (id: string) => { printerId = id; },
    fail: (path: string) => { failUpload = path; },
    onUpload: (callback: () => void) => { duringUpload = callback; },
  };
}

beforeEach(() => { restart.dispatch.mockReset(); restart.start.mockReset(); restart.failed.mockReset(); });
afterEach(() => {
  for (const id of Object.keys(editorSessions)) delete editorSessions[id];
  vi.unstubAllGlobals();
});

describe('persistent Config editor session', () => {
  it('reads an unopened printer without creating reactive state', () => {
    expect(editorSession('unopened').tabs).toEqual([]);
    expect(editorSessions.unopened).toBeUndefined();
  });

  it('retains a dirty tab across a printer switch and selects it on reopening', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    const first = editorSession('p1');
    first.tabs[0]!.content = 'unsaved';
    first.expanded = false;
    f.setPrinter('p2');
    await openConfigSessionFile(f.api, ref('logs', 'klippy.log'));
    expect(editorSession('p2').tabs).toHaveLength(1);
    expect(editorSession('p1').tabs[0]?.content).toBe('unsaved');
    f.setPrinter('p1');
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    expect(first.tabs).toHaveLength(1);
    expect(first.expanded).toBe(true);
    expect(first.tabs[0]?.content).toBe('unsaved');
  });

  it('opens mixed types beside a minimized file and keeps root-qualified identities', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    editorSession('p1').expanded = false;
    await openConfigSessionFile(f.api, ref('logs', 'klippy.log'));
    await openConfigSessionFile(f.api, ref('config', 'photo.png'));
    await openConfigSessionFile(f.api, ref('config', 'notes.txt'));
    await openConfigSessionFile(f.api, ref('docs', 'notes.txt'));
    const session = editorSession('p1');
    expect(session.tabs.map((tab) => tab.kind)).toEqual(['text', 'text', 'image', 'text', 'text']);
    expect(session.tabs[1]?.readonly).toBe(true);
    expect(session.tabs.slice(-2).map((tab) => tab.id)).toEqual(['config/notes.txt', 'docs/notes.txt']);
    expect(session.expanded).toBe(true);
    selectConfigSessionTab('p1', sessionTabId(ref('config', 'a.cfg')));
    expect(session.activeId).toBe('config/a.cfg');
  });

  it('prompts only for dirty sessions and individual dirty tabs', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    const session = editorSession('p1');
    requestConfigSessionClose('p1');
    expect(session.tabs).toHaveLength(0);
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    session.tabs[0]!.content = 'changed';
    requestConfigSessionTabClose('p1', 'config/a.cfg');
    expect(session.tabCloseId).toBe('config/a.cfg');
    requestConfigSessionClose('p1');
    expect(session.closePrompt).toBe(true);
    expect(session.tabs).toHaveLength(1);
  });

  it('closes only the chosen dirty file after saving its buffer', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    await openConfigSessionFile(f.api, ref('config', 'notes.txt'));
    const session = editorSession('p1');
    session.tabs[0]!.content = 'new config';
    session.tabs[1]!.content = 'new notes';
    expect(await closeConfigSessionTab(f.api, 'p1', 'config/a.cfg', true)).toBe(true);
    expect(session.tabs.map((tab) => tab.id)).toEqual(['config/notes.txt']);
    expect(session.tabs[0]?.content).toBe('new notes');
    expect(f.files.get('config/a.cfg')).toBe('new config');
    expect(restart.dispatch).not.toHaveBeenCalled();
  });

  it('saves all editable text and restarts Klipper once for mixed configs', async () => {
    const f = fixture();
    for (const path of ['a.cfg', 'moonraker.conf', 'notes.txt'])
      await openConfigSessionFile(f.api, ref('config', path));
    const session = editorSession('p1');
    session.tabs.forEach((tab) => { tab.content = `new ${tab.ref.path}`; });
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(true);
    expect(session.tabs).toHaveLength(0);
    expect(restart.dispatch).toHaveBeenCalledTimes(1);
    expect(restart.dispatch.mock.calls[0]?.[1]).toMatchObject({ path: 'a.cfg' });
    expect(restart.start).toHaveBeenCalledTimes(1);
    expect(f.notices).toHaveLength(1);
    expect(f.files.get('config/notes.txt')).toBe('new notes.txt');
  });

  it('saves ordinary text without a restart', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'notes.txt'));
    editorSession('p1').tabs[0]!.content = 'new notes';
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(true);
    expect(restart.dispatch).not.toHaveBeenCalled();
    expect(f.files.get('config/notes.txt')).toBe('new notes');
  });

  it('does not restart when only ordinary text changed beside a clean config', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    await openConfigSessionFile(f.api, ref('config', 'notes.txt'));
    editorSession('p1').tabs[1]!.content = 'new notes';
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(true);
    expect(restart.dispatch).not.toHaveBeenCalled();
  });

  it('restarts Moonraker without starting the Klipper monitor for moonraker.conf alone', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'moonraker.conf'));
    editorSession('p1').tabs[0]!.content = 'new moonraker';
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(true);
    expect(restart.dispatch).toHaveBeenCalledTimes(1);
    expect(restart.dispatch.mock.calls[0]?.[1]).toMatchObject({ path: 'moonraker.conf' });
    expect(restart.start).not.toHaveBeenCalled();
  });

  it('restarts Moonraker after retrying a later failed ordinary upload', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'moonraker.conf'));
    await openConfigSessionFile(f.api, ref('config', 'notes.txt'));
    const session = editorSession('p1');
    session.tabs[0]!.content = 'new moonraker';
    session.tabs[1]!.content = 'new notes';
    f.fail('config/notes.txt');
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(false);
    expect(session.moonrakerRestartPending).toBe(true);
    f.fail('');
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(true);
    expect(restart.dispatch.mock.calls[0]?.[1]).toMatchObject({ path: 'moonraker.conf' });
  });

  it('keeps partial baselines and does not restart after a failed upload', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    await openConfigSessionFile(f.api, ref('config', 'notes.txt'));
    const session = editorSession('p1');
    session.tabs[0]!.content = 'new config';
    session.tabs[1]!.content = 'new notes';
    f.fail('config/notes.txt');
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(false);
    expect(session.tabs[0]?.saved).toBe('new config');
    expect(session.tabs[1]?.saved).toBe('old notes');
    expect(restart.dispatch).not.toHaveBeenCalled();
    f.fail('');
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(true);
    expect(restart.dispatch).toHaveBeenCalledTimes(1);
    expect(restart.start.mock.calls[0]?.[4]).toHaveLength(1);
  });

  it('keeps every config in recovery after retrying a partially failed config batch', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    await openConfigSessionFile(f.api, ref('config', 'b.cfg'));
    const session = editorSession('p1');
    session.tabs[0]!.content = 'new first';
    session.tabs[1]!.content = 'new second';
    f.fail('config/b.cfg');
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(false);
    expect(session.tabs[0]?.saved).toBe('new first');
    expect(session.tabs[1]?.saved).toBe('old second config');
    f.fail('');
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(true);
    expect(restart.start.mock.calls[0]?.[4]).toHaveLength(2);
  });

  it('keeps a newer edit dirty and skips restart', async () => {
    const f = fixture();
    await openConfigSessionFile(f.api, ref('config', 'a.cfg'));
    const session = editorSession('p1');
    session.tabs[0]!.content = 'submitted';
    f.onUpload(() => { session.tabs[0]!.content = 'newer'; });
    expect(await saveAllConfigSession(f.api, 'p1')).toBe(false);
    expect(session.tabs[0]?.saved).toBe('submitted');
    expect(session.tabs[0]?.content).toBe('newer');
    expect(restart.dispatch).not.toHaveBeenCalled();
  });
});
