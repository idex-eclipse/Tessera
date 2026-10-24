import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';
import { requestRefresh, requestSearchFocus } from '../shared/file-table/file-table-state.svelte';

import { historyUi } from './page-ui-state.svelte.ts';

/** scope таблицы на странице истории (см. HistoryPage.svelte). */
export const HISTORY_SCOPE = 'page:history';

/**
 * Hotkey-обработчики (scope 'plugin': только на странице истории). Молчат, пока
 * открыт модальный диалог сброса статистики.
 */

/** Ctrl+F: фокус на поиск по истории вместо поиска браузера. */
export function hotkeyFindHistory(api: PluginApi): void {
  if (historyUi.dialogOpen) return;
  requestSearchFocus(api, HISTORY_SCOPE);
}

/** Alt+R: обновить таблицу заданий и статистику. */
export function hotkeyRefreshHistory(api: PluginApi): void {
  if (historyUi.dialogOpen) return;
  requestRefresh(api, HISTORY_SCOPE);
  historyUi.refreshSeq++;
}

/** H: открыть страницу (клавиша глобальная — работает с любой страницы). */
export function hotkeyOpenHistory(api: PluginApi): void {
  openPluginPage(api, 'history');
}
