import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';

import { consoleUi } from './page-ui-state.svelte.ts';
import { clearLines, getPrefs, refreshNow, setPrefs } from './console-session.svelte.ts';

/**
 * Hotkey-обработчики плагина (manifest.hotkeys[].handler). Scope 'plugin' — только на
 * странице консоли; Alt-комбинации работают и из поля ввода команды.
 * Пока открыто меню фильтров, клавиши страницы молчат (кроме самого Alt+F).
 */

/** С: открыть страницу (клавиша глобальная — работает с любой страницы). */
export function hotkeyOpenConsole(api: PluginApi): void {
  openPluginPage(api, 'console');
}

/** Alt+I: фокус в поле ввода. */
export function hotkeyFocusInput(): void {
  if (consoleUi.filtersOpen) return;
  consoleUi.focusInputSeq++;
}

/** Alt+C: очистить лог. */
export function hotkeyClear(api: PluginApi): void {
  if (consoleUi.filtersOpen || !api.printer.id) return;
  clearLines(api.printer.id);
}

/** Alt+R: перечитать gcode_store с принтера. */
export function hotkeyRefresh(api: PluginApi): void {
  if (consoleUi.filtersOpen || !api.printer.id) return;
  refreshNow(api, api.printer.id);
}

/** Alt+S: автопрокрутка вкл / выкл. */
export function hotkeyToggleAutoscroll(api: PluginApi): void {
  if (consoleUi.filtersOpen) return;
  const id = api.printer.id;
  if (id) setPrefs(api, id, { autoscroll: !getPrefs(id).autoscroll });
}

/** Alt+O: обратный порядок строк. */
export function hotkeyToggleReverse(api: PluginApi): void {
  if (consoleUi.filtersOpen) return;
  const id = api.printer.id;
  if (id) setPrefs(api, id, { reverse: !getPrefs(id).reverse });
}

/** Alt+F: меню фильтров. */
export function hotkeyToggleFilters(): void {
  consoleUi.toggleFiltersSeq++;
}
