import { describe, expect, it } from 'vitest';
import { createMacroBuilderSession } from '../macro-builder-session';

const original = '[gcode_macro HOME]\ngcode:\n    G28\n\n[fan]\npin: PA0\n';

/** A fake transaction adapter verifies range safety without duplicating CodeMirror internals. */
function editor(start = original) {
  let text = start;
  let revision = 0;
  let active = true;
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  return {
    adapter: {
      read: () => text,
      revision: () => revision,
      active: () => active,
      dispatch: (from: number, to: number, insert: string) => {
        edits.push({ from, to, insert });
        text = text.slice(0, from) + insert + text.slice(to);
        revision++;
      },
    },
    edits,
    read: () => text,
    change: (next: string) => { text = next; revision++; },
    close: () => { active = false; },
  };
}

function session(target: ReturnType<typeof editor>, cursor: number) {
  return createMacroBuilderSession(target.adapter, {
    printerId: 'p1', path: 'printer.cfg', cursor, macroNames: ['HOME'], commands: [], objects: [], suggest: () => [],
  });
}

describe('Config macro-builder session', () => {
  it('replaces only the current macro section in one transaction', () => {
    const target = editor();
    const edit = session(target, original.indexOf('G28'));
    expect(edit.section).toMatchObject({ name: 'HOME', firstLine: 1 });
    expect(edit.applyEdit('[gcode_macro HOME]\ngcode:\n    G28 X\n\n')).toBe('applied');
    expect(target.edits).toHaveLength(1);
    expect(target.read()).toContain('[fan]\npin: PA0');
    expect(edit.applyEdit('another edit')).toBe('stale');
  });

  it('inserts a new section at EOF when the caret is outside a macro', () => {
    const target = editor();
    const edit = session(target, original.indexOf('pin:'));
    expect(edit.section).toBeNull();
    expect(edit.createAt).toBe(original.length);
    expect(edit.applyEdit('[gcode_macro NEW]\ngcode:\n    M118 Hi\n')).toBe('applied');
    expect(target.edits[0]).toMatchObject({ from: original.length, to: original.length });
  });

  it('rejects an undo or a tab switch even if text returns to the same value', () => {
    const target = editor();
    const edit = session(target, original.indexOf('G28'));
    target.change(original.replace('G28', 'G0'));
    target.change(original);
    expect(edit.applyEdit('replacement')).toBe('stale');
    const next = session(target, original.indexOf('G28'));
    target.close();
    expect(next.applyEdit('replacement')).toBe('closed');
    expect(target.edits).toHaveLength(0);
  });
});
