import type { AppContext } from '../../app-context';
import { HOST_NOTIFICATION_SOURCE, type NotificationItem } from '../../core/notification-center.svelte.ts';

/** Подпись источника: от автора (label) → название плагина → id автора. */
export function sourceLabel(ctx: AppContext, n: NotificationItem): string {
  if (n.label) return n.label;
  if (n.pluginId === HOST_NOTIFICATION_SOURCE) return ctx.i18n.t('app.name');
  return ctx.loader.getLoadedPlugin(n.pluginId)?.manifest.name ?? n.pluginId;
}

/** Имя принтера из реестра; fallback на id (принтер удалён). Пусто, если принтера нет. */
export function printerName(ctx: AppContext, id: string): string {
  if (!id) return '';
  return ctx.printerManager.printers.find((p) => p.id === id)?.name ?? id;
}

export function fmtTime(ctx: AppContext, t: number, full = false): string {
  const d = new Date(t);
  return full ? d.toLocaleString(ctx.i18n.locale) : d.toLocaleTimeString(ctx.i18n.locale);
}
