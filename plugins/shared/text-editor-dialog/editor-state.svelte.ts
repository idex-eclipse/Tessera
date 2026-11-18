/**
 * Состояние «открыт ли текстовый редактор».
 *
 * Редактор — модальное окно поверх страницы. Hotkeys плагинов (переключение
 * вкладок, фокус на поиск таблицы и т.п.) не должны срабатывать «сквозь» него.
 * Плагины-потребители читают счётчик через `isEditorOpen()`.
 *
 * Это общий UI-кирпич в plugins/shared, а не канал данных между плагинами:
 * редактор только отмечает факт «я открыт» в собственном модуле.
 */
export const editorUi = $state({ openCount: 0 });

export function isEditorOpen(): boolean {
  return editorUi.openCount > 0;
}

/** Commands exposed to the owner's manifest hotkeys while its modal editor is mounted. */
export type EditorHotkeyAction = 'find' | 'replace' | 'save' | 'help' | 'close' | 'peek' | 'open';

let activeHotkeys: { owner: string; run: (action: EditorHotkeyAction, event?: KeyboardEvent) => void } | null = null;

/**
 * Register the current editor's actions without exposing its buffers.
 * @param owner Plugin ID that owns the modal.
 * @param run Callback for a resolved editor command.
 * @returns Cleanup function for the mounted dialog.
 */
export function registerEditorHotkeys(owner: string, run: (action: EditorHotkeyAction, event?: KeyboardEvent) => void): () => void {
  const entry = { owner, run };
  activeHotkeys = entry;
  return () => { if (activeHotkeys === entry) activeHotkeys = null; };
}

/**
 * Dispatch an owner-scoped command after the host has matched a configurable binding.
 * @param owner Plugin ID expected to own the active modal.
 * @param action Editor action to invoke.
 * @param event Original keyboard event for nested peek focus detection.
 */
export function runEditorHotkey(owner: string, action: EditorHotkeyAction, event?: KeyboardEvent): void {
  if (activeHotkeys?.owner === owner) activeHotkeys.run(action, event);
}
