import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';
import { requestRefresh, requestSearchFocus } from '../shared/file-table/file-table-state.svelte';
import { isEditorOpen } from '../shared/text-editor-dialog/editor-state.svelte';

import { jobsUi } from './page-ui-state.svelte.ts';

/** scope таблицы на странице Jobs (см. JobsPage.svelte). */
export const JOBS_PAGE_SCOPE = 'page:gcodes';

/**
 * Hotkey-обработчики (scope 'plugin': только на странице Jobs). Молчат, пока открыт
 * текстовый редактор или 3MF-инспектор — оба модальные и перекрывают страницу.
 */
function blocked(): boolean {
  return isEditorOpen() || jobsUi.modalOpen;
}

/** Ctrl+F: фокус на поиск файлов вместо поиска браузера. */
export function hotkeyFindJob(api: PluginApi): void {
  if (blocked()) return;
  requestSearchFocus(api, JOBS_PAGE_SCOPE);
}

/** Alt+R: обновить список файлов. */
export function hotkeyRefreshJobs(api: PluginApi): void {
  if (blocked()) return;
  requestRefresh(api, JOBS_PAGE_SCOPE);
}

/** J: открыть страницу (клавиша глобальная — работает с любой страницы). */
export function hotkeyOpenJobs(api: PluginApi): void {
  openPluginPage(api, 'jobs');
}
