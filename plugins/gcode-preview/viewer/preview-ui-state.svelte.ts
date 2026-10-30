import { onDestroy } from 'svelte';

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
 * Состояние просмотрщика, общее для компонентов и обработчиков hotkeys.
 * `dialogOpen` — открыт диалог исключения объекта (модальный): пока он открыт,
 * команды молчат.
 */
export const previewUi = $state({
  dialogOpen: false,
});

/**
 * Обработчики hotkeys живут в модуле плагина и не видят компоненты, поэтому шлют им
 * команды через реестр слушателей — без $effect и без «счётчика команд» в $state.
 */
const listeners = new Set<(command: PreviewCommand) => void>();

/** Подписка на команды; возвращает отписку. Чистая функция — тестируется без компонента. */
export function onPreviewCommand(handler: (command: PreviewCommand) => void): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function sendPreviewCommand(command: PreviewCommand): void {
  if (previewUi.dialogOpen) return;
  // копия: слушатель может отписаться (размонтироваться) прямо во время обработки
  for (const handler of [...listeners]) {
    try {
      handler(command);
    } catch (e) {
      // сбой одного подписчика не должен лишать команды остальных
      console.error('[gcode-preview] command handler failed:', command.name, e);
    }
  }
}

/**
 * Подписка компонента на команды (вызывать при инициализации). Команды, посланные до
 * монтирования, не выполняются; каждая выполняется ровно один раз каждым смонтированным
 * подписчиком. Отписка — при уничтожении компонента.
 */
export function usePreviewCommands(handle: (command: PreviewCommand) => void): void {
  onDestroy(onPreviewCommand(handle));
}
