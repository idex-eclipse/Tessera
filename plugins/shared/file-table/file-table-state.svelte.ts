import type { PluginApi } from '../../../plugin-sdk/src/types';
import { watchSettings } from '../settings/watch-settings';

let searchMap = $state<Record<string, string>>({});
let tickMap = $state<Record<string, number>>({});
let pathMap = $state<Record<string, string>>({});
let noticeMap = $state<Record<string, string | null>>({});
let focusMap = $state<Record<string, number>>({});

// One revision signal lets table settings react to either active or fixed printer namespaces.
let rev = $state(0);
const wired = new WeakMap<object, Set<string>>();

function wire(api: PluginApi, printerId?: string): void {
  const target = printerId ?? '@active';
  const targets = wired.get(api) ?? new Set<string>();
  if (targets.has(target)) return;
  targets.add(target);
  wired.set(api, targets);

  // Fixed fleet tables subscribe to their printer namespace; active tables retain switch-aware behavior.
  if (printerId) api.settingsFor(printerId).onChange(() => { rev++; });
  else watchSettings(api, () => { rev++; });
}

function key(api: PluginApi, scope: string, printerId?: string): string {
  return `${printerId ?? api.printer.id}:${scope}`;
}

// Search, refresh, navigation, notices and focus remain isolated per printer and table scope.
export function getSearch(api: PluginApi, scope: string, printerId?: string): string {
  return searchMap[key(api, scope, printerId)] ?? '';
}
export function setSearch(api: PluginApi, scope: string, value: string, printerId?: string): void {
  searchMap[key(api, scope, printerId)] = value;
}
export function requestRefresh(api: PluginApi, scope: string, printerId?: string): void {
  const mapKey = key(api, scope, printerId);
  tickMap[mapKey] = (tickMap[mapKey] ?? 0) + 1;
}
export function getRefreshTick(api: PluginApi, scope: string, printerId?: string): number {
  return tickMap[key(api, scope, printerId)] ?? 0;
}
export function getCurrentPath(api: PluginApi, scope: string, printerId?: string): string {
  return pathMap[key(api, scope, printerId)] ?? '';
}
export function setCurrentPath(api: PluginApi, scope: string, path: string, printerId?: string): void {
  pathMap[key(api, scope, printerId)] = path;
}
/** Request focus for a table search input, normally from the Jobs hotkey. */
export function requestSearchFocus(api: PluginApi, scope: string, printerId?: string): void {
  const mapKey = key(api, scope, printerId);
  focusMap[mapKey] = (focusMap[mapKey] ?? 0) + 1;
}
export function getSearchFocusTick(api: PluginApi, scope: string, printerId?: string): number {
  return focusMap[key(api, scope, printerId)] ?? 0;
}
export function getNotice(api: PluginApi, scope: string, printerId?: string): string | null {
  return noticeMap[key(api, scope, printerId)] ?? null;
}
export function setNotice(api: PluginApi, scope: string, message: string | null, printerId?: string): void {
  noticeMap[key(api, scope, printerId)] = message;
}

/** Ensure settings changes for this table target invalidate derived column and sort state. */
export function ensureColumnsLoaded(api: PluginApi, _scope: string, printerId?: string): void {
  wire(api, printerId);
}

export function getVisibleColumns(
  api: PluginApi,
  scope: string,
  allKeys: string[],
  defaults: string[],
  printerId?: string,
): string[] {
  wire(api, printerId);
  void rev;
  const stored = api.settingsFor(printerId ?? api.printer.id).get<string[]>(`columns:${scope}`);
  if (!Array.isArray(stored) || stored.length === 0) return defaults;
  const filtered = stored.filter((columnKey) => allKeys.includes(columnKey));
  if (!filtered.includes('name')) filtered.unshift('name');
  return filtered;
}

export function setVisibleColumns(api: PluginApi, scope: string, keys: string[], printerId?: string): void {
  api.settingsFor(printerId ?? api.printer.id).set(`columns:${scope}`, keys);
}

/** Persisted sort descriptor for one printer and table scope. */
export interface SortState {
  key: string;
  dir: 1 | -1;
}

export function getSort(api: PluginApi, scope: string, printerId?: string): SortState {
  wire(api, printerId);
  void rev;
  const stored = api.settingsFor(printerId ?? api.printer.id).get<SortState>(`sort:${scope}`);
  if (stored && typeof stored.key === 'string' && (stored.dir === 1 || stored.dir === -1)) return stored;
  return { key: 'modified', dir: -1 };
}

export function setSort(api: PluginApi, scope: string, key: string, dir: 1 | -1, printerId?: string): void {
  api.settingsFor(printerId ?? api.printer.id).set(`sort:${scope}`, { key, dir });
}
