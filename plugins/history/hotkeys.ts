import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';
import { requestRefresh, requestSearchFocus } from '../shared/file-table/file-table-state.svelte';
import { isRtl } from '../shared/popover-align';

import {
  historyUi,
  isHistoryDialogOpen,
  moveHistoryTab,
  selectHistoryTab,
} from './state/page-ui-state.svelte.ts';

/** Identifies the file-table state owned by the History page. */
export const HISTORY_SCOPE = 'page:history';

/** Focuses History search instead of the browser search, revealing its tab first. */
export function hotkeyFindHistory(api: PluginApi): void {
  if (isHistoryDialogOpen()) return;
  historyUi.showHistorySeq++;
  requestSearchFocus(api, HISTORY_SCOPE);
}

/** Refreshes the retained job list and printer totals together. */
export function hotkeyRefreshHistory(api: PluginApi): void {
  if (isHistoryDialogOpen()) return;
  requestRefresh(api, HISTORY_SCOPE);
  historyUi.refreshSeq++;
}

/** Selects the built-in History table tab. */
export function hotkeyTabHistory(): void {
  if (!isHistoryDialogOpen()) selectHistoryTab('history');
}

/** Selects the built-in combined statistics tab. */
export function hotkeyTabStatistics(): void {
  if (!isHistoryDialogOpen()) selectHistoryTab('stats');
}

/** Selects the tab visually to the left, including contributed tabs and RTL order. */
export function hotkeyTabLeft(): void {
  if (!isHistoryDialogOpen()) moveHistoryTab('left', isRtl());
}

/** Selects the tab visually to the right, including contributed tabs and RTL order. */
export function hotkeyTabRight(): void {
  if (!isHistoryDialogOpen()) moveHistoryTab('right', isRtl());
}

/** Opens the History page from the global shortcut scope. */
export function hotkeyOpenHistory(api: PluginApi): void {
  openPluginPage(api, 'history');
}
