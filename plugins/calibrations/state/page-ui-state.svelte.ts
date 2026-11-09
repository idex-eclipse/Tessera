/**
 * UI-состояние страницы калибровок, управляемое снаружи компонента (hotkeys).
 * Обработчик hotkey живёт в модуле плагина и не имеет доступа к компоненту,
 * поэтому просит страницу сменить вкладку через этот module-state.
 */

export type CalibrationsTab = 'mesh' | 'probe' | 'heaters' | 'shaper';

/** Describes a physical horizontal direction in the rendered tab row. */
export type CalibrationsTabSide = 'left' | 'right';

export const pageUi = $state<{
  requestedTab: string | null;
  activeTab: string;
  tabOrder: string[];
  seq: number;
}>({
  requestedTab: null,
  activeTab: 'mesh',
  tabOrder: [],
  seq: 0,
});

/** Запросить вкладку; страница применит её, если вкладка доступна на этом принтере. */
export function requestTab(tab: CalibrationsTab): void {
  pageUi.requestedTab = tab;
  pageUi.seq++;
}

/** Requests the visually adjacent available tab and wraps at either end. */
export function moveCalibrationsTab(side: CalibrationsTabSide, rtl: boolean): void {
  const tabs = pageUi.tabOrder;
  if (tabs.length < 2) return;
  const current = tabs.indexOf(pageUi.activeTab);
  const index = current >= 0 ? current : 0;
  // DOM order starts at the visual right in RTL, so the physical arrow step is reversed.
  const step = (side === 'right') !== rtl ? 1 : -1;
  pageUi.requestedTab = tabs[(index + step + tabs.length) % tabs.length] ?? tabs[0] ?? null;
  pageUi.seq++;
}
