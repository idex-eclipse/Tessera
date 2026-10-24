import type { PluginApi } from '../../plugin-sdk/src/types';

import { requestSearchFocus } from '../shared/file-table/file-table-state.svelte';
import { isEditorOpen } from '../shared/text-editor-dialog/editor-state.svelte';

import { activeSearchScope, setTab } from './page-ui-state.svelte.ts';

/**
 * Hotkey-обработчики плагина (manifest.hotkeys[].handler), scope 'plugin':
 * срабатывают только на странице конфигов.
 *
 * Пока открыт текстовый редактор (модальный), обработчики молчат — иначе
 * клавиши «просачивались» бы на страницу под ним. Ctrl+F внутри редактора
 * обрабатывает сам редактор (его обработчик на capture гасит событие раньше хоста).
 */

/** Ctrl+F: фокус на поиск файлов активной таблицы вместо поиска браузера. */
export function hotkeyFindFile(api: PluginApi): void {
  if (isEditorOpen()) return;
  requestSearchFocus(api, activeSearchScope());
}

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
