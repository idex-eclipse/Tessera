import type { FleetIndexEntry, FleetTag } from '../../../plugin-sdk/src/types';

/**
 * Чистая логика поиска/фильтров fleet-режима. Хост не знает смысла тегов и
 * searchText — он только сопоставляет строки.
 */

export interface FleetFilterPrinter {
  id: string;
  name: string;
}

export interface FleetTagCount {
  tag: FleetTag;
  count: number;
}

/**
 * Принтер проходит фильтр, если:
 * - запрос пуст ИЛИ входит (без учёта регистра) в имя принтера или searchText;
 * - И активных тегов нет ИЛИ у принтера есть хотя бы один из них (OR).
 */
export function matchPrinter(
  printer: FleetFilterPrinter,
  entry: FleetIndexEntry | null,
  query: string,
  activeTagIds: ReadonlySet<string>,
): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q) {
    const inName = printer.name.toLocaleLowerCase().includes(q);
    const inText = (entry?.searchText ?? '').toLocaleLowerCase().includes(q);
    if (!inName && !inText) return false;
  }

  if (activeTagIds.size > 0) {
    if (!entry) return false;
    if (!entry.tags.some((t) => activeTagIds.has(t.id))) return false;
  }

  return true;
}

/**
 * Объединение тегов всех принтеров со счётчиками (число принтеров с тегом).
 * Порядок: tag.order, затем id. Первое объявление тега задаёт его подпись/иконку.
 */
export function collectTags(
  entries: ReadonlyArray<FleetIndexEntry | null>,
): FleetTagCount[] {
  const byId = new Map<string, FleetTagCount>();
  for (const entry of entries) {
    if (!entry) continue;
    for (const tag of entry.tags) {
      const found = byId.get(tag.id);
      if (found) found.count++;
      else byId.set(tag.id, { tag, count: 1 });
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      (a.tag.order ?? 0) - (b.tag.order ?? 0) || a.tag.id.localeCompare(b.tag.id),
  );
}
