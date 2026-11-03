/**
 * Версия контракта плагинов (PluginApi, манифест, CE-контракт), которую реализует этот хост.
 * Формат "MAJOR.MINOR".
 *
 * - MINOR растёт при любом обратно совместимом добавлении: метод PluginApi, поле или
 *   поверхность манифеста. Плагин, которому это нужно, пишет новую версию в manifest.pluginApi.
 * - MAJOR — несовместимые изменения (стараемся избегать).
 *
 * Точки расширения сюда не входят: их набор — часть версии плагина-владельца (в т.ч. @core/*),
 * дополнение требует её через manifest.dependencies (см. dependencies.ts).
 *
 * Плагин совместим, если MAJOR совпадает, а его MINOR не больше хостового.
 * Нет поля в манифесте (и наследное целое 1 в реестре) — LEGACY_PLUGIN_API.
 *
 * Та же константа — HOST_PLUGIN_API в deploy/tessera-ext.py (тест сверяет их).
 *
 * История:
 *   0.7 — базовый контракт (до точек расширения)
 *   0.8 — extensionPoints / extensions, api.extensions, manifest.dependencies
 *   0.9 — handle.klippyStream: bulk-потоки Klipper (load_cell/dump_force) через /klippysocket
 *   0.10 — api.notifications.push: центр уведомлений хоста (только запись)
 */
export const PLUGIN_API = '0.10';

export const LEGACY_PLUGIN_API = '0.7';

const PLUGIN_API_RE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;

/** [major, minor] или null для некорректного значения. undefined и целое 1 — наследие. */
export function parsePluginApi(value: unknown): [number, number] | null {
  if (value === undefined || value === 1) value = LEGACY_PLUGIN_API;
  if (typeof value !== 'string') return null;
  const m = PLUGIN_API_RE.exec(value);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * 'ok' | 'invalid' (не разобрать) | 'newer' (нужна более новая Tessera) |
 * 'major' (другой MAJOR: несовместимый контракт).
 */
export function checkPluginApi(
  required: unknown,
  host: string = PLUGIN_API,
): 'ok' | 'invalid' | 'newer' | 'major' {
  const need = parsePluginApi(required);
  const have = parsePluginApi(host);
  if (!need || !have) return 'invalid';
  if (need[0] !== have[0]) return 'major';
  return need[1] <= have[1] ? 'ok' : 'newer';
}

/** Строка для сообщений: '0.8' / 'invalid'. */
export function formatPluginApi(value: unknown): string {
  const v = parsePluginApi(value);
  return v ? `${v[0]}.${v[1]}` : String(value);
}
