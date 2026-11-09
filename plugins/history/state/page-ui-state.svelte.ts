/** Built-in History tab ids in their logical LTR order. */
export const HISTORY_BUILTIN_TABS = ['history', 'stats'] as const;

/** Identifies one of the two tabs provided by the History plugin itself. */
export type HistoryBuiltinTab = (typeof HISTORY_BUILTIN_TABS)[number];

/** Describes a physical horizontal direction in the rendered tab row. */
export type HistoryTabSide = 'left' | 'right';

/** Bridges module-level hotkey requests and modal state to the mounted History page. */
export const historyUi = $state({
  activeTab: 'history' as string,
  tabOrder: [...HISTORY_BUILTIN_TABS] as string[],
  refreshSeq: 0,
  showHistorySeq: 0,
  resetRequestSeq: 0,
  resetDialogOpen: false,
  jobDialogOpen: false,
});

/** Selects a currently available built-in or contributed History tab. */
export function selectHistoryTab(tab: string): void {
  if (historyUi.tabOrder.includes(tab)) historyUi.activeTab = tab;
}

/** Moves to the tab visually adjacent on the requested side, wrapping at either end. */
export function moveHistoryTab(side: HistoryTabSide, rtl: boolean): void {
  const tabs = historyUi.tabOrder;
  if (tabs.length < 2) return;
  const current = tabs.indexOf(historyUi.activeTab);
  const index = current >= 0 ? current : 0;
  // DOM order starts at the visual right in RTL, so the physical arrow step is reversed.
  const step = (side === 'right') !== rtl ? 1 : -1;
  historyUi.activeTab = tabs[(index + step + tabs.length) % tabs.length] ?? tabs[0] ?? 'history';
}

/** Returns whether History page hotkeys must stay inactive behind a modal dialog. */
export function isHistoryDialogOpen(): boolean {
  return historyUi.resetDialogOpen || historyUi.jobDialogOpen;
}
