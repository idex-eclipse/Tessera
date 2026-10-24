import { untrack } from 'svelte';

import type { PluginApi } from '../../../plugin-sdk/src/types';

export type PreviewVariant = 'page' | 'widget';

let clearedMap = $state<Record<string, boolean>>({});

function key(api: PluginApi, variant: PreviewVariant): string {
  return `${api.printer.id}:${variant}`;
}

export function isCleared(api: PluginApi, variant: PreviewVariant): boolean {
  return clearedMap[key(api, variant)] ?? false;
}

export function unclear(api: PluginApi, variant: PreviewVariant): void {
  clearedMap[key(api, variant)] = false;
}

export function clearPreview(api: PluginApi, variant: PreviewVariant): void {
  clearedMap[key(api, variant)] = true;

  const pid = api.printer.id;
  const base = variant === 'page' ? `#/p/${encodeURIComponent(pid)}/gcode-preview` : `#/p/${encodeURIComponent(pid)}`;
  globalThis.location.replace(base); // без записи в историю
}

// ------------------------------------------------------------------
// Команды hotkeys → компоненты
// ------------------------------------------------------------------

/** Что hotkeys просят сделать у просмотрщика / страницы. */
export type PreviewCommand =
  | { name: 'layer-step'; amount: number }
  | { name: 'layer-first' }
  | { name: 'layer-last' }
  | { name: 'toggle-travel' }
  | { name: 'toggle-bounds' }
  | { name: 'toggle-mode' }
  | { name: 'toggle-follow' }
  | { name: 'toggle-color' }
  | { name: 'clear' }
  | { name: 'reload' };

/**
 * Обработчики hotkeys живут в модуле плагина и не видят компоненты, поэтому шлют им
 * команды через это состояние. `dialogOpen` — открыт диалог исключения объекта
 * (модальный): пока он открыт, команды молчат.
 */
export const previewUi = $state({
  commandId: 0,
  command: null as PreviewCommand | null,
  dialogOpen: false,
});

export function sendPreviewCommand(command: PreviewCommand): void {
  if (previewUi.dialogOpen) return;
  previewUi.command = command;
  previewUi.commandId++;
}

/**
 * Подписка компонента на команды (вызывать при инициализации). Команды, посланные до
 * монтирования, не выполняются; каждая выполняется ровно один раз.
 */
export function usePreviewCommands(handle: (command: PreviewCommand) => void): void {
  let seen = untrack(() => previewUi.commandId);
  $effect(() => {
    const id = previewUi.commandId;
    if (id === seen) return;
    seen = id;
    const command = untrack(() => previewUi.command);
    if (command) untrack(() => handle(command));
  });
}
