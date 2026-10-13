import type { DashboardWidgetLayoutItem } from './settings-store.svelte';

/**
 * Кураторский стандартный состав дашборда.
 * Порядок = порядок появления в гриде (findFreeSpot в Dashboard.svelte
 * уже умеет автоматически расставлять). Размеры подтягиваются из
 * WidgetContribution.defaultSize через резолвер.
 * Состав — продуктовое решение хоста, плагины сюда не вписываются.
 */
const DEFAULT_DASHBOARD: ReadonlyArray<{ type: string; w?: number; h?: number }> = [
  { type: 'tools',   w: 6, h: 10 },
  { type: 'temperature', w: 6, h: 5 },
  { type: 'console',  w: 6, h: 5 },
  { type: 'jobs-table', w: 12, h: 5 },
  { type: 'gcode-preview', w: 4, h: 4 },
  { type: 'outputs', w: 4, h: 4 },
  { type: 'bed-mesh', w: 4, h: 4 },
  { type: 'macros', w: 5, h: 8 },
];

export interface DefaultLayoutResolver {
  (type: string): { provider: string; defaultSize?: { w: number; h: number } } | null;
}

function makeId(type: string, index: number): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `default-${type}-${index}-${Date.now().toString(36)}`;
}

export function buildDefaultLayout(
  resolve: DefaultLayoutResolver,
): DashboardWidgetLayoutItem[] {
  const items: DashboardWidgetLayoutItem[] = [];
  DEFAULT_DASHBOARD.forEach((d, i) => {
    const r = resolve(d.type);
    if (!r) return; // плагин выключен/удалён — пропускаем без дыр
    const size = d.w !== undefined && d.h !== undefined
      ? { w: d.w, h: d.h }
      : (r.defaultSize ?? { w: 4, h: 4 });
    items.push({
      instanceId: makeId(d.type, i),
      type: d.type,
      provider: r.provider,
      x: 0, y: 0,       // Dashboard.findFreeSpot расставит при рендере
      w: size.w,
      h: size.h,
    });
  });
  return items;
}