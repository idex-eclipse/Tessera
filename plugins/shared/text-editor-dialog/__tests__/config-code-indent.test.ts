import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { configTabEdit } from '../config-code-indent';

/** Apply the same transaction that the CodeMirror Tab binding dispatches. */
function tab(doc: string, anchor: number, head = anchor, outdent = false) {
  const state = EditorState.create({ doc, selection: { anchor, head } });
  const edit = configTabEdit(state, outdent);
  if (!edit) return { doc, anchor, head };
  const next = state.update(edit).state;
  return { doc: next.doc.toString(), anchor: next.selection.main.anchor, head: next.selection.main.head };
}

describe('Config CodeMirror Tab', () => {
  it('inserts four spaces at an unselected cursor', () => {
    expect(tab('G28', 1)).toEqual({ doc: 'G    28', anchor: 5, head: 5 });
  });

  it('indents the start of one selected line, even for a partial selection', () => {
    expect(tab('  G28\nM400', 2, 5).doc).toBe('      G28\nM400');
  });

  it('indents selected lines but excludes a following line selected only at column zero', () => {
    expect(tab('G28\nM400\nG1', 0, 9).doc).toBe('    G28\n    M400\nG1');
  });

  it('removes at most four leading spaces with Shift+Tab', () => {
    expect(tab('      G28\nM400', 6, 9, true).doc).toBe('  G28\nM400');
  });
});
