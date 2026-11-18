import { ChangeSet, EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const INDENT = '    ';

/**
 * Build a four-space Tab edit while keeping the selected text in place.
 * @param state Current CodeMirror document and selection.
 * @param outdent Whether Shift+Tab should remove up to one indentation unit.
 * @returns Changes and mapped selection, or null when there is no indentation to remove.
 */
export function configTabEdit(state: EditorState, outdent = false): { changes: ChangeSet; selection: SelectionRange } | null {
  const range = state.selection.main;
  const doc = state.doc;
  if (range.empty && !outdent) {
    return {
      changes: ChangeSet.of([{ from: range.head, insert: INDENT }], doc.length),
      selection: EditorSelection.cursor(range.head + INDENT.length),
    };
  }

  const first = doc.lineAt(range.from);
  const last = doc.lineAt(range.to);
  // A selection ending at the next line's column zero does not include that line.
  const lastNumber = !range.empty && range.to === last.from && last.number > first.number
    ? last.number - 1 : last.number;
  const edits: Array<{ from: number; to?: number; insert: string }> = [];
  for (let number = first.number; number <= lastNumber; number++) {
    const line = doc.line(number);
    if (outdent) {
      const width = line.text.startsWith('\t') ? 1 : Math.min(4, /^ */.exec(line.text)?.[0].length ?? 0);
      if (width) edits.push({ from: line.from, to: line.from + width, insert: '' });
    } else {
      edits.push({ from: line.from, insert: INDENT });
    }
  }
  if (!edits.length) return null;
  const changes = ChangeSet.of(edits, doc.length);
  return {
    changes,
    selection: EditorSelection.range(
      changes.mapPos(range.anchor, range.anchor === first.from ? -1 : 1),
      changes.mapPos(range.head, 1),
    ),
  };
}

/** Apply Tab as one undoable CodeMirror transaction. */
export function runConfigTab(view: EditorView, outdent = false): boolean {
  const edit = configTabEdit(view.state, outdent);
  if (edit) view.dispatch({ ...edit, userEvent: 'input.indent' });
  return true;
}
