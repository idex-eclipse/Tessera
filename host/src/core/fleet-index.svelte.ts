import type { FleetIndexEntry, FleetTag } from '../../../plugin-sdk/src/types';

/**
 * Fleet-индекс: ЕДИНСТВЕННЫЙ канал плагин → хост.
 *
 * Хост хранит непрозрачные теги и текст для поиска, которые публикуют панели
 * принтеров (api.fleet.publish), и строит из них универсальный UI поиска и
 * фильтров fleet-режима. Смысл тегов и текста хосту неизвестен: он только
 * сопоставляет строки и показывает подписи, которые прислал плагин.
 *
 * Запись привязана к паре (pluginId, printerId); несколько плагинов могут
 * публиковать для одного принтера — forPrinter() сливает их.
 */

const MAX_TAGS = 16;
const MAX_TEXT_LENGTH = 512;

export type FleetIndex = ReturnType<typeof createFleetIndex>;

function sanitizeTag(raw: unknown): FleetTag | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<FleetTag>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.labelKey !== 'string' || !t.labelKey) return null;
  return {
    id: t.id,
    labelKey: t.labelKey,
    ...(typeof t.icon === 'string' && t.icon ? { icon: t.icon } : {}),
    ...(typeof t.order === 'number' && Number.isFinite(t.order) ? { order: t.order } : {}),
  };
}

function sanitizeEntry(raw: FleetIndexEntry): FleetIndexEntry {
  const tags: FleetTag[] = [];
  const seen = new Set<string>();
  for (const candidate of Array.isArray(raw?.tags) ? raw.tags : []) {
    const tag = sanitizeTag(candidate);
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  const searchText =
    typeof raw?.searchText === 'string' ? raw.searchText.slice(0, MAX_TEXT_LENGTH) : '';
  return { tags, searchText };
}

function sameEntry(a: FleetIndexEntry, b: FleetIndexEntry): boolean {
  if (a.searchText !== b.searchText || a.tags.length !== b.tags.length) return false;
  return a.tags.every((t, i) => {
    const o = b.tags[i]!;
    return t.id === o.id && t.labelKey === o.labelKey && t.icon === o.icon && t.order === o.order;
  });
}

export function createFleetIndex() {
  // printerId → pluginId → entry. Замена объекта целиком — для реактивности.
  let data = $state<Record<string, Record<string, FleetIndexEntry>>>({});

  /**
   * Дедуп: панель публикует производную запись на каждый тик прогресса,
   * а менятся она редко — без проверки fleet перерисовывался бы постоянно.
   */
  function publish(pluginId: string, printerId: string, raw: FleetIndexEntry): void {
    const entry = sanitizeEntry(raw);
    const prev = data[printerId]?.[pluginId];
    if (prev && sameEntry(prev, entry)) return;
    data = { ...data, [printerId]: { ...data[printerId], [pluginId]: entry } };
  }

  function retract(pluginId: string, printerId: string): void {
    const byPlugin = data[printerId];
    if (!byPlugin || !(pluginId in byPlugin)) return;
    const { [pluginId]: _removed, ...rest } = byPlugin;
    const { [printerId]: _printer, ...others } = data;
    data = Object.keys(rest).length > 0 ? { ...others, [printerId]: rest } : others;
  }

  /** Слияние записей всех плагинов принтера; null — никто ничего не публиковал. */
  function forPrinter(printerId: string): FleetIndexEntry | null {
    const byPlugin = data[printerId];
    if (!byPlugin) return null;
    const entries = Object.values(byPlugin);
    if (entries.length === 0) return null;

    const tags: FleetTag[] = [];
    const seen = new Set<string>();
    const texts: string[] = [];
    for (const e of entries) {
      for (const tag of e.tags) {
        if (seen.has(tag.id)) continue;
        seen.add(tag.id);
        tags.push(tag);
      }
      if (e.searchText) texts.push(e.searchText);
    }
    return { tags, searchText: texts.join('\n') };
  }

  /** Убирает записи принтеров, которых больше нет в настройках. */
  function prune(validPrinterIds: Iterable<string>): void {
    const valid = new Set(validPrinterIds);
    const stale = Object.keys(data).filter((id) => !valid.has(id));
    if (stale.length === 0) return;
    const next = { ...data };
    for (const id of stale) delete next[id];
    data = next;
  }

  return { publish, retract, forPrinter, prune };
}
