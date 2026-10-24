import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';

import { sendPreviewCommand } from './viewer/preview-ui-state.svelte.ts';

/**
 * Hotkey-обработчики плагина (manifest.hotkeys[].handler). Scope 'plugin' — только на
 * странице предпросмотра; они шлют команды компонентам через preview-ui-state.
 * Пока открыт диалог исключения объекта, команды молчат.
 */

/** G: открыть страницу (клавиша глобальная — работает с любой страницы). */
export function hotkeyOpenPreview(api: PluginApi): void {
  openPluginPage(api, 'gcode-preview');
}

/** Alt+PageUp / Alt+PageDown: слой выше / ниже. */
export function hotkeyLayerUp(): void {
  sendPreviewCommand({ name: 'layer-step', amount: 1 });
}
export function hotkeyLayerDown(): void {
  sendPreviewCommand({ name: 'layer-step', amount: -1 });
}

/** Alt+Shift+PageUp / Alt+Shift+PageDown: сразу на 10 слоёв. */
export function hotkeyLayerUp10(): void {
  sendPreviewCommand({ name: 'layer-step', amount: 10 });
}
export function hotkeyLayerDown10(): void {
  sendPreviewCommand({ name: 'layer-step', amount: -10 });
}

/** Alt+Home / Alt+End: первый / последний слой. */
export function hotkeyLayerFirst(): void {
  sendPreviewCommand({ name: 'layer-first' });
}
export function hotkeyLayerLast(): void {
  sendPreviewCommand({ name: 'layer-last' });
}

/** Alt+T: холостые перемещения. Alt+B: границы. */
export function hotkeyToggleTravel(): void {
  sendPreviewCommand({ name: 'toggle-travel' });
}
export function hotkeyToggleBounds(): void {
  sendPreviewCommand({ name: 'toggle-bounds' });
}

/** Alt+M: 2D ↔ 3D. */
export function hotkeyToggleMode(): void {
  sendPreviewCommand({ name: 'toggle-mode' });
}

/** Alt+F: слежение за печатью. */
export function hotkeyToggleFollow(): void {
  sendPreviewCommand({ name: 'toggle-follow' });
}

/** Alt+C: раскраска по экструдеру / по типу линии. */
export function hotkeyToggleColor(): void {
  sendPreviewCommand({ name: 'toggle-color' });
}

/** Alt+X: убрать файл с экрана. */
export function hotkeyClearPreview(): void {
  sendPreviewCommand({ name: 'clear' });
}

/** Alt+R: заново загрузить и разобрать файл. */
export function hotkeyReloadPreview(): void {
  sendPreviewCommand({ name: 'reload' });
}
