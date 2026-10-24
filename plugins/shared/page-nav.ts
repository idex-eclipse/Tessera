import type { PluginApi } from '../../plugin-sdk/src/types';

/**
 * Навигация на страницу плагина для hotkeys «открыть страницу».
 *
 * Адрес — hash-маршрут хоста: `#/p/<printerId>/<pageId>`. Хост сам обработает
 * смену hash (в том числе закроет fleet-режим, если он открыт). Без активного
 * принтера перехода нет.
 */
export function pageHash(printerId: string, pageId: string): string {
  return `#/p/${encodeURIComponent(printerId)}/${encodeURIComponent(pageId)}`;
}

export function openPluginPage(api: PluginApi, pageId: string): void {
  const printerId = api.printer.id;
  if (!printerId) return;
  globalThis.location.hash = pageHash(printerId, pageId);
}
