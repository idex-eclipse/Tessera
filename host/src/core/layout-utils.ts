import type { DashboardWidgetLayoutItem } from './settings-store.svelte';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Простой greedy packing: ищет первую свободную ячейку (слева направо, сверху вниз)
 * для элемента размера w×h, учитывая уже размещённые элементы.
 * Grid: 12 колонок, строки не ограничены (MAX_H = 16 в Dashboard.svelte).
 */
export function findFreeSpot(
  items: Box[],
  w: number,
  h: number,
): { x: number; y: number } {
  const maxY = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + w <= 12; x++) {
      const box = { x, y, w, h };
      if (!items.some((i) => overlaps(i, box))) return { x, y };
    }
  }

  return { x: 0, y: maxY };
}