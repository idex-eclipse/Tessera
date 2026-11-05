/**
 * UI-состояние страницы калибровок, управляемое снаружи компонента (hotkeys).
 * Обработчик hotkey живёт в модуле плагина и не имеет доступа к компоненту,
 * поэтому просит страницу сменить вкладку через этот module-state.
 */

export type CalibrationsTab = 'mesh' | 'probe' | 'heaters' | 'shaper';

export const pageUi = $state<{ requestedTab: CalibrationsTab | null; seq: number }>({
  requestedTab: null,
  seq: 0,
});

/** Запросить вкладку; страница применит её, если вкладка доступна на этом принтере. */
export function requestTab(tab: CalibrationsTab): void {
  pageUi.requestedTab = tab;
  pageUi.seq++;
}
