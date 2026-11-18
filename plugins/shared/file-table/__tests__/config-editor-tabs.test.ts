import { describe, expect, it, vi } from 'vitest';
import type { MoonrakerProxyHandle } from '../../../../plugin-sdk/src/types';
import { closeConfigEditorTab, saveConfigTabsForRestart, type ConfigEditorTab, type ConfigTabWrites } from '../config-editor-tabs';

const ref = (path: string) => ({ root: 'config', path, isDir: false });
const tab = (path: string, content: string, saved = 'old'): ConfigEditorTab =>
  ({ ref: ref(path), content, saved });

/** Recording operations make backup ordering and partial failures observable. */
function writes(log: string[]): ConfigTabWrites {
  return {
    createRestartAttemptBackup: vi.fn(async (file, id) => {
      log.push(`snapshot:${file.path}`);
      return ref(`.backup/${file.path}.${id}.restart.bak`);
    }),
    saveConfigText: vi.fn(async (file) => { log.push(`save:${file.path}`); }),
  };
}

describe('Config editor tabs', () => {
  it('saves only the closing tab and selects its neighbor', async () => {
    const log: string[] = [];
    const tabs = [tab('a.cfg', 'changed'), tab('b.cfg', 'other')];
    const result = await closeConfigEditorTab(tabs, 'a.cfg', true,
      {} as MoonrakerProxyHandle, writes(log));
    expect(log).toEqual(['save:a.cfg']);
    expect(result.remaining).toEqual([tabs[1]]);
    expect(result.nextPath).toBe('b.cfg');
    expect(tabs[0]?.saved).toBe('changed');
    expect(tabs[1]?.saved).toBe('old');
  });

  it('discards only the closing tab without a write', async () => {
    const log: string[] = [];
    const result = await closeConfigEditorTab([tab('a.cfg', 'changed')], 'a.cfg', false,
      {} as MoonrakerProxyHandle, writes(log));
    expect(result).toEqual({ remaining: [], nextPath: null, closed: true });
    expect(log).toEqual([]);
  });

  it('keeps the tab dirty if its save fails', async () => {
    const current = tab('a.cfg', 'changed');
    const failure = { ...writes([]), saveConfigText: vi.fn(async () => { throw new Error('upload failed'); }) };
    await expect(closeConfigEditorTab([current], 'a.cfg', true,
      {} as MoonrakerProxyHandle, failure)).rejects.toThrow('upload failed');
    expect(current.saved).toBe('old');
  });

  it('keeps the tab open when a newer edit arrives during its save', async () => {
    const current = tab('a.cfg', 'submitted');
    const ops = writes([]);
    ops.saveConfigText = vi.fn(async () => { current.content = 'newer'; });
    const result = await closeConfigEditorTab([current], 'a.cfg', true,
      {} as MoonrakerProxyHandle, ops);
    expect(result.closed).toBe(false);
    expect(result.remaining).toEqual([current]);
    expect(current.saved).toBe('submitted');
    expect(current.content).toBe('newer');
  });

  it('snapshots every dirty file before writing and puts the active file first', async () => {
    const log: string[] = [];
    const tabs = [tab('a.cfg', 'new a'), tab('b.cfg', 'new b'), tab('clean.cfg', 'same', 'same')];
    const target = { request: vi.fn(async () => { log.push('state'); return { state: 'ready' }; }) } as unknown as MoonrakerProxyHandle;
    const result = await saveConfigTabsForRestart(tabs, 'b.cfg', 'one', target, writes(log));
    expect(log).toEqual(['state', 'snapshot:b.cfg', 'snapshot:a.cfg', 'save:b.cfg', 'save:a.cfg']);
    expect(result?.files.map((file) => file.file.path)).toEqual(['b.cfg', 'a.cfg']);
    expect(result?.files.every((file) => file.backup !== null)).toBe(true);
    expect(tabs.map((item) => item.saved)).toEqual(['new a', 'new b', 'same']);
  });

  it('does not upload when an attempt snapshot fails', async () => {
    const log: string[] = [];
    const target = { request: vi.fn(async () => ({ state: 'ready' })) } as unknown as MoonrakerProxyHandle;
    const ops = writes(log);
    ops.createRestartAttemptBackup = vi.fn(async (file) => {
      log.push(`snapshot:${file.path}`);
      if (file.path === 'b.cfg') throw new Error('copy failed');
      return ref(`.backup/${file.path}.bak`);
    });
    await expect(saveConfigTabsForRestart([tab('a.cfg', 'a'), tab('b.cfg', 'b')],
      'a.cfg', 'one', target, ops)).rejects.toThrow('copy failed');
    expect(log).toEqual(['snapshot:a.cfg', 'snapshot:b.cfg']);
  });

  it('leaves failed and later files dirty if one upload fails', async () => {
    const log: string[] = [];
    const tabs = [tab('a.cfg', 'a'), tab('b.cfg', 'b'), tab('c.cfg', 'c')];
    const target = { request: vi.fn(async () => ({ state: 'shutdown' })) } as unknown as MoonrakerProxyHandle;
    const ops = writes(log);
    ops.saveConfigText = vi.fn(async (file) => {
      log.push(`save:${file.path}`);
      if (file.path === 'b.cfg') throw new Error('upload failed');
    });
    await expect(saveConfigTabsForRestart(tabs, 'a.cfg', 'one', target, ops)).rejects.toThrow('upload failed');
    expect(log).toEqual(['save:a.cfg', 'save:b.cfg']);
    expect(tabs.map((item) => item.saved)).toEqual(['a', 'old', 'old']);
  });

  it('reports newer edits made during uploads so the caller can skip restart', async () => {
    const tabs = [tab('a.cfg', 'submitted')];
    const target = { request: vi.fn(async () => ({ state: 'shutdown' })) } as unknown as MoonrakerProxyHandle;
    const ops = writes([]);
    ops.saveConfigText = vi.fn(async () => { tabs[0]!.content = 'newer'; });
    const result = await saveConfigTabsForRestart(tabs, 'a.cfg', 'one', target, ops);
    expect(result?.changedDuringSave).toBe(true);
    expect(tabs[0]?.saved).toBe('submitted');
    expect(tabs[0]?.content).toBe('newer');
  });
});
