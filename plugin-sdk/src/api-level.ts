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
 * Plugin API 1.0 also accepts 0.7-0.14 for the migration release; 0.15+ is unsupported.
 * Нет поля в манифесте (и наследное целое 1 в реестре) — LEGACY_PLUGIN_API.
 *
 * Та же константа — HOST_PLUGIN_API в deploy/tessera-ext.py (тест сверяет их).
 *
 * История:
 *   0.7 — базовый контракт (до точек расширения)
 *   0.8 — extensionPoints / extensions, api.extensions, manifest.dependencies
 *   0.9 — handle.klippyStream: bulk-потоки Klipper (load_cell/dump_force) через /klippysocket
 *   0.10 — api.notifications.push: центр уведомлений хоста (только запись)
 *   0.11 — klippyStream: поток load_cell_probe/dump_taps в списке разрешённых методов
 *   0.12 — klippyStream: чёрный список вместо белого (мост свободен для чтения), onAck;
 *          klippyRequest: разовые запросы с ответом по /klippysocket
 *   0.13 — manifest.services и api.services: прокси хоста к внешним сервисам плагина
 *          (tessera-ext serve, секрет хранится на принтере)
 *   0.14 — api.notifications.push actions: plugin-owned Custom Element actions in notifications
 *   1.0 — active-printer moonraker() and settings deprecated
 */
export const PLUGIN_API = '1.0';

export const LEGACY_PLUGIN_API = '0.7';

/** The last 0.x contract still provided during the 1.0 migration window. */
export const LAST_LEGACY_PLUGIN_API = '0.14';

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
  // Only 1.0 retains the old runtime contract; the next API release must drop this branch.
  if (host === '1.0' && need[0] === 0) {
    if (need[1] < parsePluginApi(LEGACY_PLUGIN_API)![1]) return 'major';
    return need[1] <= parsePluginApi(LAST_LEGACY_PLUGIN_API)![1] ? 'ok' : 'newer';
  }
  if (need[0] !== have[0]) return 'major';
  return need[1] <= have[1] ? 'ok' : 'newer';
}

/** Строка для сообщений: '0.8' / 'invalid'. */
export function formatPluginApi(value: unknown): string {
  const v = parsePluginApi(value);
  return v ? `${v[0]}.${v[1]}` : String(value);
}
