import { scanMacroDefinitions } from './macro-index';

/** Config's existing completion result mapped to a builder field offset. */
export interface MacroBuilderSuggestion {
  label: string;
  insert: string;
  kind: 'var' | 'cmd' | 'macro' | 'param' | 'value' | 'word';
  detail?: string;
  from: number;
}

/** A limited edit session passed to the Config macro-builder action. */
export interface MacroBuilderSession {
  printerId: string;
  path: string;
  revision: number;
  cursor: number;
  section: { name: string; from: number; to: number; firstLine: number; lastLine: number; text: string } | null;
  createAt: number;
  macroNames: string[];
  commands: Array<{ name: string; params: string[] }>;
  objects: string[];
  /** Ask Config to complete a field without copying its parser into the plugin. */
  suggest: (value: string, cursor: number, variables: readonly { name: string; value: string }[], macroName: string) => MacroBuilderSuggestion[];
  /** Replace only the offered section, or insert a new one at createAt. */
  applyEdit: (replacement: string) => 'applied' | 'stale' | 'closed';
}

/** The editor adapter keeps CodeMirror and its undo history inside Config. */
export interface MacroBuilderEditor {
  read: () => string;
  revision: () => number;
  active: () => boolean;
  dispatch: (from: number, to: number, insert: string) => void;
}

/**
 * Capture one section or an EOF insertion point; reject delayed edits after any buffer change.
 * @param editor The current Config buffer and its single-transaction dispatch adapter.
 * @param input Printer, file, cursor, and completion context captured when the dialog opens.
 * @returns An opaque session that cannot write outside its captured range.
 */
export function createMacroBuilderSession(
  editor: MacroBuilderEditor,
  input: Omit<MacroBuilderSession, 'revision' | 'section' | 'createAt' | 'applyEdit'>,
): MacroBuilderSession {
  const source = editor.read();
  const revision = editor.revision();
  const hit = scanMacroDefinitions(source, input.path).find((section) =>
    input.cursor >= section.from && input.cursor < section.to);
  const section = hit ? { ...hit, text: source.slice(hit.from, hit.to) } : null;
  const createAt = source.length;
  let used = false;
  return {
    ...input, revision, section, createAt,
    applyEdit(replacement) {
      if (!editor.active()) return 'closed';
      if (used || editor.revision() !== revision || editor.read() !== source) return 'stale';
      if (section && editor.read().slice(section.from, section.to) !== section.text) return 'stale';
      const from = section?.from ?? createAt;
      const to = section?.to ?? createAt;
      // A new section must start on a fresh line; the plugin owns its trailing newline.
      const insert = section ? replacement : `${source && !source.endsWith('\n') ? '\n' : ''}${replacement}`;
      editor.dispatch(from, to, insert);
      used = true;
      return 'applied';
    },
  };
}
