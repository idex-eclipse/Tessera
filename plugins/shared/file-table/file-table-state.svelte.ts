import type { PluginApi } from '../../../plugin-sdk/src/types';

let searchMap = $state<Record<string, string>>({});
let tickMap = $state<Record<string, number>>({});
let pathMap = $state<Record<string, string>>({});
let noticeMap = $state<Record<string, string | null>>({});
let focusMap = $state<Record<string, number>>({});

// реактивность: bump при любом onChange настроек плагина (в т.ч. смена sync-namespace)
let rev = $state(0);
const wired = new WeakSet<object>();

function wire(api: PluginApi): void {
  if (wired.has(api)) return;
  wired.add(api);

  // api.settings.onChange привязан к принтеру, активному в момент подписки, поэтому
  // при смене принтера переподписываемся — иначе изменения настроек второго принтера
  // не доходили бы до таблицы (пока не сменится принтер ещё раз).
  let offSettings = api.settings.onChange(() => {
    rev++;
  });

  // смена принтера → переподписка и перечитать (GLOBAL тот же, но per-printer разные)
  api.onPrinterChange(() => {
    offSettings();
    offSettings = api.settings.onChange(() => {
      rev++;
    });
    rev++;
  });
}

function key(api: PluginApi, scope: string): string {
  return `${api.printer.id}:${scope}`;
}

// ---------------- search / refresh / path / notice ----------------

export function getSearch(api: PluginApi, scope: string): string {
  return searchMap[key(api, scope)] ?? '';
}
export function setSearch(api: PluginApi, scope: string, v: string): void {
  searchMap[key(api, scope)] = v;
}
export function requestRefresh(api: PluginApi, scope: string): void {
  const k = key(api, scope);
  tickMap[k] = (tickMap[k] ?? 0) + 1;
}
export function getRefreshTick(api: PluginApi, scope: string): number {
  return tickMap[key(api, scope)] ?? 0;
}
export function getCurrentPath(api: PluginApi, scope: string): string {
  return pathMap[key(api, scope)] ?? '';
}
export function setCurrentPath(api: PluginApi, scope: string, p: string): void {
  pathMap[key(api, scope)] = p;
}
/** Запрос фокуса на поле поиска таблицы (hotkey Ctrl+F вместо браузерного поиска). */
export function requestSearchFocus(api: PluginApi, scope: string): void {
  const k = key(api, scope);
  focusMap[k] = (focusMap[k] ?? 0) + 1;
}
export function getSearchFocusTick(api: PluginApi, scope: string): number {
  return focusMap[key(api, scope)] ?? 0;
}
export function getNotice(api: PluginApi, scope: string): string | null {
  return noticeMap[key(api, scope)] ?? null;
}
export function setNotice(api: PluginApi, scope: string, m: string | null): void {
  noticeMap[key(api, scope)] = m;
}

// ---------------- columns (без зеркала, читаем api.settings напрямую) ----------------

export function ensureColumnsLoaded(api: PluginApi, scope: string): void {
  wire(api); // no-op по данным, только гарантирует подписку
}

export function getVisibleColumns(
  api: PluginApi,
  scope: string,
  allKeys: string[],
  defaults: string[],
): string[] {
  wire(api);
  void rev; // перечитывать при любом onChange (в т.ч. смена namespace)

  const stored = api.settings.get<string[]>(`columns:${scope}`);
  if (!Array.isArray(stored) || stored.length === 0) return defaults;

  const filtered = stored.filter((k) => allKeys.includes(k));
  if (!filtered.includes('name')) filtered.unshift('name');
  return filtered;
}

export function setVisibleColumns(api: PluginApi, scope: string, keys: string[]): void {
  api.settings.set(`columns:${scope}`, keys);
}

// ---------------- sort (тоже напрямую) ----------------

export interface SortState {
  key: string;
  dir: 1 | -1;
}

export function getSort(api: PluginApi, scope: string): SortState {
  wire(api);
  void rev;

  const s = api.settings.get<SortState>(`sort:${scope}`);
  if (s && typeof s.key === 'string' && (s.dir === 1 || s.dir === -1)) return s;
  return { key: 'modified', dir: -1 };
}

export function setSort(api: PluginApi, scope: string, key: string, dir: 1 | -1): void {
  api.settings.set(`sort:${scope}`, { key, dir });
}