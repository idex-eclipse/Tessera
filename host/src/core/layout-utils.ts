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
type Placed = Box & { instanceId: string };

/**
 * Раздвигает перекрытия после изменения элемента `activeInstanceId`: всё, что он задел,
 * сдвигается вниз, и так по цепочке. Возвращает копию.
 */
export function settle<T extends Placed>(items: T[], activeInstanceId: string): T[] {
  const result = items.map((i) => ({ ...i }));
  const active = result.find((i) => i.instanceId === activeInstanceId);
  if (!active) return result;

  const queue: T[] = [active];
  const inQueue = new Set<string>([active.instanceId]);
  let guard = 0;

  while (queue.length > 0 && guard++ < 500) {
    const cur = queue.shift()!;
    for (const other of result) {
      if (other.instanceId === cur.instanceId) continue;
      if (overlaps(cur, other)) {
        other.y = cur.y + cur.h;
        if (!inQueue.has(other.instanceId)) {
          inQueue.add(other.instanceId);
          queue.push(other);
        }
      }
    }
  }

  return result;
}

/** Порядок элементов на узком экране: сверху вниз, затем слева направо. */
function sortedByPosition<T extends Placed>(items: T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

function packColumn<T extends Placed>(ordered: T[]): T[] {
  let y = 0;
  return ordered.map((item) => {
    const next = { ...item, x: 0, w: 12, y };
    y += item.h;
    return next;
  });
}

/** Сдвигает элемент на `delta` позиций в одноколоночном порядке. */
export function moveInStack<T extends Placed>(items: T[], instanceId: string, delta: -1 | 1): T[] {
  const ordered = sortedByPosition(items);
  const from = ordered.findIndex((i) => i.instanceId === instanceId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ordered.length) return packColumn(ordered);

  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved!);
  return packColumn(ordered);
}

/**
 * Меняет высоту элемента в пределах [min, max], сохраняя мобильный порядок. При росте всё, что
 * начиналось ниже его прежнего края, сдвигается на одну величину (`settle` двигал бы только
 * задетых, и соседи менялись бы местами). При уменьшении позиции не меняются.
 */
export function setHeight<T extends Placed>(
  items: T[],
  instanceId: string,
  h: number,
  min: number,
  max: number,
): T[] {
  const target = items.find((i) => i.instanceId === instanceId);
  if (!target) return items.map((i) => ({ ...i }));

  const clamped = Math.min(max, Math.max(min, h));
  const bottom = target.y + target.h;
  const delta = clamped - target.h;

  return items.map((i) => {
    if (i.instanceId === instanceId) return { ...i, h: clamped };
    return delta > 0 && i.y >= bottom ? { ...i, y: i.y + delta } : { ...i };
  });
}
