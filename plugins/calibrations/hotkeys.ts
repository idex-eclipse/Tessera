import type { PluginApi } from '../../plugin-sdk/src/types';

import { openPluginPage } from '../shared/page-nav';
import { isRtl } from '../shared/popover-align';
import { gcode, runGcode } from './lib/commands.ts';
import { moveCalibrationsTab, requestTab, type CalibrationsTab } from './state/page-ui-state.svelte.ts';
import { isManualProbeActive } from './data/printer-tracker.ts';

/**
 * Hotkey-обработчики плагина (manifest.hotkeys[].handler).
 *
 * Две группы:
 *
 * 1. scope 'plugin' (Alt+1…4) — переключение вкладок страницы калибровок;
 *    срабатывают только на странице плагина.
 *
 * 2. scope 'global' — управление ручным зондированием (TESTZ), диалог которого —
 *    оверлей плагина и может появиться на ЛЮБОЙ странице. Поэтому и клавиши
 *    глобальные. Обработчики действуют только когда зондирование реально
 *    активно на активном принтере; иначе — no-op. (Хост вызывает
 *    preventDefault() до обработчика, поэтому клавиши выбраны с модификатором
 *    Alt, чтобы не перехватывать обычный ввод и прокрутку.)
 */

function openTab(tab: CalibrationsTab): () => void {
  return () => requestTab(tab);
}

export const hotkeyTabMesh = openTab('mesh');
export const hotkeyTabProbe = openTab('probe');
export const hotkeyTabHeaters = openTab('heaters');
export const hotkeyTabShaper = openTab('shaper');

/** Selects the available tab visually to the left, including contributed tabs and RTL order. */
export function hotkeyTabLeft(): void {
  moveCalibrationsTab('left', isRtl());
}

/** Selects the available tab visually to the right, including contributed tabs and RTL order. */
export function hotkeyTabRight(): void {
  moveCalibrationsTab('right', isRtl());
}

/** Шаги ручного зондирования для hotkeys: обычный и точный (мм). */
export const TESTZ_STEP = '0.1';
export const TESTZ_STEP_FINE = '0.01';

async function whileProbing(api: PluginApi, script: string): Promise<void> {
  const printerId = api.printer.id;
  if (!printerId || !isManualProbeActive(printerId)) return;
  await runGcode(api.moonrakerFor(api.printer.id), script);
}

export const hotkeyTestzUp = (api: PluginApi) => whileProbing(api, gcode.testz(`+${TESTZ_STEP}`));
export const hotkeyTestzDown = (api: PluginApi) => whileProbing(api, gcode.testz(`-${TESTZ_STEP}`));
export const hotkeyTestzUpFine = (api: PluginApi) => whileProbing(api, gcode.testz(`+${TESTZ_STEP_FINE}`));
export const hotkeyTestzDownFine = (api: PluginApi) => whileProbing(api, gcode.testz(`-${TESTZ_STEP_FINE}`));
export const hotkeyProbeAccept = (api: PluginApi) => whileProbing(api, gcode.accept);
export const hotkeyProbeAbort = (api: PluginApi) => whileProbing(api, gcode.abort);

/** Shift+A: открыть страницу (клавиша глобальная — работает с любой страницы). */
export function hotkeyOpenCalibrations(api: PluginApi): void {
  openPluginPage(api, 'calibrations');
}
