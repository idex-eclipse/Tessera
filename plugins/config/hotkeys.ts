import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';
import { requestSearchFocus } from '../shared/file-table/file-table-state.svelte';
import { isEditorOpen, runEditorHotkey, type EditorHotkeyAction } from '../shared/text-editor-dialog/editor-state.svelte';

import { activeSearchScope, setTab } from './state/page-ui-state.svelte.ts';

/** Manifest handlers share the Config page scope; contextual entries run only inside its editor. */

const CONFIG_OWNER = '@core/config';

/** Search the active file table, or the editor buffer while its modal is open. */
export function hotkeyFindFile(api: PluginApi, event?: KeyboardEvent): void {
  if (isEditorOpen()) { runEditorHotkey(CONFIG_OWNER, 'find', event); return; }
  requestSearchFocus(api, activeSearchScope());
}

/** Route a Config editor command through its mounted dialog. */
function editorAction(action: EditorHotkeyAction, event?: KeyboardEvent): void {
  runEditorHotkey(CONFIG_OWNER, action, event);
}

/** Open replacement in the active editor buffer. */
export function hotkeyEditorReplace(_api: PluginApi, event: KeyboardEvent): void { editorAction('replace', event); }
/** Save the active editor buffer through its existing backup path. */
export function hotkeyEditorSave(_api: PluginApi, event: KeyboardEvent): void { editorAction('save', event); }
/** Show section help at the editor caret. */
export function hotkeyEditorHelp(_api: PluginApi, event: KeyboardEvent): void { editorAction('help', event); }
/** Close the innermost editor popup or the editor itself. */
export function hotkeyEditorClose(_api: PluginApi, event: KeyboardEvent): void { editorAction('close', event); }
/** Reveal a called macro below its call. */
export function hotkeyEditorPeek(_api: PluginApi, event: KeyboardEvent): void { editorAction('peek', event); }
/** Open a called macro in its source file. */
export function hotkeyEditorOpenMacro(_api: PluginApi, event: KeyboardEvent): void { editorAction('open', event); }

/** Alt+L / Alt+D / Alt+C: вкладки правой таблицы. */
export function hotkeyTabLogs(): void {
  if (!isEditorOpen()) setTab('logs');
}

export function hotkeyTabDocs(): void {
  if (!isEditorOpen()) setTab('docs');
}

export function hotkeyTabExamples(): void {
  if (!isEditorOpen()) setTab('config_examples');
}

/** Shift+C: открыть страницу (клавиша глобальная — работает с любой страницы). */
export function hotkeyOpenConfig(api: PluginApi): void {
  openPluginPage(api, 'config');
}
