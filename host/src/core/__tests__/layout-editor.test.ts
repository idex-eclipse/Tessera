import { describe, expect, it } from 'vitest';

import { createLayoutEditor, type EditSnapshot } from '../layout-editor.svelte.ts';
import type { Route } from '../router.svelte.ts';

function setup(initial: Partial<EditSnapshot> = {}) {
  let stored: EditSnapshot = {
    dashboardLayout: [],
    dashboardLayoutCustomized: false,
    quickChips: [],
    quickChipsCustomized: false,
    quickChipsLayout: 'grid',
    ...initial,
  };
  let route = { kind: 'dashboard', printerId: 'p1', query: { edit: '1' } } as Route;
  let printerId: string | null = 'p1';
  let left = 0;
  const editor = createLayoutEditor({
    getRoute: () => route,
    getPrinterId: () => printerId,
    read: () => JSON.parse(JSON.stringify(stored)),
    write: (_id, s) => {
      stored = JSON.parse(JSON.stringify(s));
    },
    leave: () => {
      left++;
    },
  });
  const widget = (id: string) => ({ instanceId: id, type: 't', provider: 'p', x: 0, y: 0, w: 4, h: 2 });
  return {
    editor,
    get stored() {
      return stored;
    },
    add(id: string) {
      stored = { ...stored, dashboardLayout: [...stored.dashboardLayout, widget(id)], dashboardLayoutCustomized: true };
    },
    setRoute(r: Route) {
      route = r as typeof route;
    },
    setPrinter(id: string | null) {
      printerId = id;
    },
    setChipLayout(layout: EditSnapshot['quickChipsLayout']) {
      stored = { ...stored, quickChipsLayout: layout };
    },
    get left() {
      return left;
    },
  };
}

const ids = (s: EditSnapshot) => s.dashboardLayout.map((i) => i.instanceId);

describe('layout editor', () => {
  it('is active only on the dashboard with edit=1', () => {
    const t = setup();
    expect(t.editor.active).toBe(true);
    t.setRoute({ kind: 'dashboard', printerId: 'p1', query: {} } as Route);
    expect(t.editor.active).toBe(false);
  });

  it('records one step per changed() and ignores an unchanged state', () => {
    const t = setup();
    t.editor.sync();
    t.editor.changed();
    expect(t.editor.canUndo).toBe(false);
    t.add('a');
    t.editor.changed();
    t.editor.changed();
    expect(t.editor.canUndo).toBe(true);
    t.editor.undo();
    expect(t.editor.canUndo).toBe(false);
  });

  it('undoes and redoes, restoring the customized flag', () => {
    const t = setup();
    t.editor.sync();
    t.add('a');
    t.editor.changed();
    t.add('b');
    t.editor.changed();

    t.editor.undo();
    expect(ids(t.stored)).toEqual(['a']);
    t.editor.undo();
    expect(ids(t.stored)).toEqual([]);
    expect(t.stored.dashboardLayoutCustomized).toBe(false);
    expect(t.editor.canRedo).toBe(true);

    t.editor.redo();
    t.editor.redo();
    expect(ids(t.stored)).toEqual(['a', 'b']);
    expect(t.editor.canRedo).toBe(false);
  });

  it('drops redo steps after a new change', () => {
    const t = setup();
    t.editor.sync();
    t.add('a');
    t.editor.changed();
    t.editor.undo();
    t.add('b');
    t.editor.changed();
    expect(t.editor.canRedo).toBe(false);
    expect(ids(t.stored)).toEqual(['b']);
  });

  it('keeps later steps consistent after undo and redo', () => {
    const t = setup();
    t.editor.sync();
    t.add('a');
    t.editor.changed();
    t.editor.undo();
    t.editor.redo();
    t.add('b');
    t.editor.changed();
    t.editor.undo();
    expect(ids(t.stored)).toEqual(['a']);
  });

  it('cancel restores the state from entry and leaves', () => {
    const t = setup({
      quickChips: [{ instanceId: 'c', type: 'x', provider: 'p', id: 'i' }],
      quickChipsCustomized: true,
    });
    t.editor.sync();
    t.add('a');
    t.editor.changed();
    t.add('b');
    t.editor.changed();
    t.editor.cancel();
    expect(t.stored.dashboardLayout).toEqual([]);
    expect(t.stored.dashboardLayoutCustomized).toBe(false);
    expect(t.stored.quickChips).toHaveLength(1);
    expect(t.left).toBe(1);
    expect(t.editor.canUndo).toBe(false);
  });

  it('undoes, redoes and cancels the chip layout mode', () => {
    const t = setup();
    t.editor.sync();
    t.setChipLayout('scroll');
    t.editor.changed();

    t.editor.undo();
    expect(t.stored.quickChipsLayout).toBe('grid');
    t.editor.redo();
    expect(t.stored.quickChipsLayout).toBe('scroll');
    t.editor.cancel();
    expect(t.stored.quickChipsLayout).toBe('grid');
  });

  it('end keeps the changes, leaves and clears the history', () => {
    const t = setup();
    t.editor.sync();
    t.add('a');
    t.editor.changed();
    t.editor.end();
    expect(ids(t.stored)).toEqual(['a']);
    expect(t.left).toBe(1);
    expect(t.editor.canUndo).toBe(false);
  });

  it('starts a fresh session when the printer changes or edit mode ends', () => {
    const t = setup();
    t.editor.sync();
    t.add('a');
    t.editor.changed();
    t.setPrinter('p2');
    t.editor.sync();
    expect(t.editor.canUndo).toBe(false);

    t.add('b');
    t.editor.changed();
    t.setRoute({ kind: 'dashboard', printerId: 'p2', query: {} } as Route);
    t.editor.sync();
    expect(t.editor.canUndo).toBe(false);
  });
});
