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

/** Chooses whether every selected fleet tag or any selected tag must match. */
export type FleetFilterMode = 'or' | 'and';

/**
 * Matches a printer by name or published search text, then applies the selected
 * opaque tags with the requested mode. An empty tag selection matches all tags.
 * @param printer Printer identity supplied by the host.
 * @param entry Merged plugin index for this printer, or null when absent.
 * @param query User-entered search text.
 * @param activeTagIds Selected opaque tag identifiers.
 * @param mode Whether any or all selected tags must be present.
 * @returns Whether the printer remains visible in fleet mode.
 */
export function matchPrinter(
  printer: FleetFilterPrinter,
  entry: FleetIndexEntry | null,
  query: string,
  activeTagIds: ReadonlySet<string>,
  mode: FleetFilterMode = 'or',
): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q) {
    const inName = printer.name.toLocaleLowerCase().includes(q);
    const inText = (entry?.searchText ?? '').toLocaleLowerCase().includes(q);
    if (!inName && !inText) return false;
  }

  if (activeTagIds.size > 0) {
    if (!entry) return false;
    const present = new Set(entry.tags.map((tag) => tag.id));
    const matches = mode === 'and'
      ? [...activeTagIds].every((id) => present.has(id))
      : [...activeTagIds].some((id) => present.has(id));
    if (!matches) return false;
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
