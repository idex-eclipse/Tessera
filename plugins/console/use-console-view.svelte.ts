import { onDestroy } from 'svelte';

import type { PluginApi } from '../../plugin-sdk/src/types';

import {
  applyFilters,
  attach,
  compileFilters,
  getCommands,
  getHistory,
  getLines,
  getMacroParams,
  getPrefs,
  isConnected,
  pushHistory,
  sendCommand,
} from './console-session.svelte.ts';
import { buildBuiltins } from './gcode-builtins';
import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';

/**
 * Общая «вьюха» консоли для страницы и виджета: подключает сессию (с отпиской при
 * размонтировании), даёт производные данные активного принтера и действия ввода.
 * Вызывать при инициализации компонента.
 *
 * Читает api.printer.id внутри $derived — при смене принтера всё пересчитывается само.
 */
export function useConsoleView(api: PluginApi) {
  const detach = attach(api);
  onDestroy(detach);

  const klippy = useKlippyState(api);

  const printerId = $derived(api.printer.id);
  const lines = $derived(getLines(printerId));
  const connected = $derived(isConnected(printerId));
  const commands = $derived(getCommands(printerId));
  const macroParams = $derived(getMacroParams(printerId));
  const history = $derived(getHistory(printerId));
  const prefs = $derived(getPrefs(printerId));
  const builtins = $derived(buildBuiltins((k) => api.i18n.t(k)));
  const visibleLines = $derived(
    prefs.filtersEnabled ? applyFilters(lines, compileFilters(prefs.filters)) : lines,
  );
  const displayLines = $derived(prefs.reverse ? [...visibleLines].reverse() : visibleLines);
  const inputDisabled = $derived(!connected || !klippy.ready);

  let fillTrigger = $state<{ text: string; ts: number } | null>(null);

  return {
    get printerId() { return printerId; },
    get lines() { return lines; },
    get connected() { return connected; },
    get commands() { return commands; },
    get macroParams() { return macroParams; },
    get history() { return history; },
    get prefs() { return prefs; },
    get builtins() { return builtins; },
    get displayLines() { return displayLines; },
    get inputDisabled() { return inputDisabled; },
    get klippyReady() { return klippy.ready; },
    get fillTrigger() { return fillTrigger; },

    /** Подставить текст в поле ввода (клик по строке лога / команде из списка). */
    fill(text: string): void {
      fillTrigger = { text, ts: Date.now() };
    },

    send(script: string): void {
      pushHistory(api, printerId, script);
      void sendCommand(api, printerId, script);
    },
  };
}
