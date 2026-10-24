import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';
import { systemUiState } from './system-ui-state.svelte.ts';

/** id страницы «Система» в manifest.pages. */
export const MACHINE_PAGE_ID = 'machine';

/**
 * Hotkey-обработчики @core/system (manifest.hotkeys[].handler).
 *
 * Центр уведомлений — оверлей этого плагина и может быть открыт на любой странице,
 * поэтому клавиша глобальная. Состояние (открыт/закрыт) принадлежит плагину, а не
 * хосту, — поэтому hotkey объявлен здесь, а не среди хостовых.
 *
 * Аварийная остановка (M112) намеренно БЕЗ горячей клавиши: действие необратимо
 * и слишком опасно для случайного нажатия.
 */

/** N: показать / скрыть центр уведомлений. */
export function hotkeyToggleNotifications(): void {
  systemUiState.notificationsOpen = !systemUiState.notificationsOpen;
}

/** M: открыть страницу «Система» активного принтера. */
export function hotkeyOpenMachine(api: PluginApi): void {
  openPluginPage(api, MACHINE_PAGE_ID);
}

/**
 * U: открыть выбор файла для загрузки (блок «Загрузить и напечатать» в правой панели).
 * Панель обрабатывает запрос в своём эффекте — input.click() вызывается в рамках
 * пользовательского нажатия, поэтому браузер диалог разрешает.
 */
export function hotkeyUploadFile(): void {
  systemUiState.uploadPickSeq++;
}

/** P: переключить флажок «Начать печать после загрузки». */
export function hotkeyTogglePrintAfter(): void {
  systemUiState.printAfterToggleSeq++;
}

/** Alt+R (только на странице «Система»): перечитать данные. */
export function hotkeyRefreshMachine(): void {
  systemUiState.refreshSeq++;
}
