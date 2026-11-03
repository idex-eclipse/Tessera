import { checkPluginApi } from '../../../plugin-sdk/src/api-level.ts';

import type { HostI18n } from './host-i18n.svelte.ts';
import type { RegistryPlugin } from './extensions-installer.svelte.ts';
import { HOST_NOTIFICATION_SOURCE, type NotificationCenter } from './notification-center.svelte.ts';
import type { SettingsStore } from './settings-store.svelte.ts';
import type { UiUpdateStatus } from './ui-updater.svelte.ts';

/**
 * Проверка обновлений при открытии UI: Tessera (служба tessera-update-manager) и плагины
 * реестра (служба tessera-ext). Результат — обычные уведомления центра хоста: только текст,
 * без ссылок и действий.
 *
 * Правила:
 * - не чаще раза в settings.ui.updateCheck.intervalHours (по умолчанию 4, минимум 1);
 * - время проверки запоминается, только если хоть одна служба ответила: нет служб
 *   (CLI-установка, dev-сервер) или отказ авторизации — повтор при следующем открытии;
 * - о каждой версии сообщаем один раз (settings.ui.updateCheck.notified), иначе та же
 *   новость приходила бы при каждой перезагрузке страницы.
 */

const HOUR_MS = 3_600_000;
/** Ключ в `notified` для самой Tessera. */
const UI_KEY = 'ui';

export interface UpdateCheckDeps {
  settings: Pick<SettingsStore, 'ui' | 'setUpdateCheckSettings'>;
  notifications: Pick<NotificationCenter, 'push'>;
  i18n: Pick<HostI18n, 't'>;
  /** Состояние Tessera; null — служба недоступна или отказала. */
  loadUi: () => Promise<UiUpdateStatus | null>;
  /** Плагины реестра; null — служба недоступна или отказала. */
  loadPlugins: () => Promise<RegistryPlugin[] | null>;
  /** Для тестов. */
  now?: () => number;
}

/** Пора ли проверять. Время в будущем (сбитые часы) считаем просроченным, а не вечным. */
export function updateCheckDue(ui: Pick<SettingsStore['ui'], 'updateCheck'>, now: number): boolean {
  const { intervalHours, lastCheckedAt } = ui.updateCheck;
  if (lastCheckedAt <= 0 || lastCheckedAt > now) return true;
  return now - lastCheckedAt >= intervalHours * HOUR_MS;
}

/** Что нового нашлось: ключ в `notified` → версия и текст сообщения. */
interface Finding {
  key: string;
  version: string;
  text: string;
}

function findUiUpdate(status: UiUpdateStatus, i18n: UpdateCheckDeps['i18n']): Finding | null {
  if (!status.updateAvailable || !status.remote?.commit) return null;
  const to = status.remote.version ? `v${status.remote.version} (${status.remote.commit})` : status.remote.commit;
  return { key: UI_KEY, version: status.remote.commit, text: i18n.t('notifications.update.ui', { to }) };
}

function findPluginUpdates(plugins: readonly RegistryPlugin[], i18n: UpdateCheckDeps['i18n']): Finding[] {
  const ready: RegistryPlugin[] = [];
  const blocked: RegistryPlugin[] = [];
  for (const p of plugins) {
    // Обновлять через UI можно только то, что поставила служба; чужие папки — дело CLI.
    if (p.state !== 'update' || !p.managed) continue;
    (checkPluginApi(p.pluginApi) === 'ok' ? ready : blocked).push(p);
  }

  const out: Finding[] = [];
  // Одно сообщение на группу: десять плагинов не должны давать десять тостов.
  const group = (list: RegistryPlugin[], suffix: string, text: (names: string) => string): void => {
    if (list.length === 0) return;
    const names = list.map((p) => `${p.name} ${p.version}`).join(', ');
    out.push({
      key: `plugins${suffix}`,
      // Версия группы — её состав: новая версия любого плагина — новая новость.
      version: list.map((p) => `${p.id}@${p.version}`).sort().join(','),
      text: text(names),
    });
  };
  group(ready, '', (list) => i18n.t('notifications.update.plugins', { list }));
  // Эти обновления службой не поставить (нужен более новый plugin API): сначала обновить Tessera.
  group(blocked, ':needs-ui', (list) => i18n.t('notifications.update.pluginsNeedUi', { list }));
  return out;
}

/**
 * Проверяет обновления и кладёт новости в центр уведомлений.
 * @returns true — проверка выполнена (хоть одна служба ответила); false — пропущена или нет служб.
 */
export async function runUpdateCheck(deps: UpdateCheckDeps): Promise<boolean> {
  const { settings, notifications, i18n } = deps;
  const now = (deps.now ?? Date.now)();
  if (!updateCheckDue(settings.ui, now)) return false;

  // Параллельно: службы независимы, а ждать GitHub дважды подряд незачем.
  const [uiStatus, plugins] = await Promise.all([
    deps.loadUi().catch(() => null),
    deps.loadPlugins().catch(() => null),
  ]);
  if (!uiStatus && !plugins) return false;

  const findings: Finding[] = [];
  const answeredKeys = new Set<string>();
  if (uiStatus) {
    answeredKeys.add(UI_KEY);
    const f = findUiUpdate(uiStatus, i18n);
    if (f) findings.push(f);
  }
  if (plugins) {
    answeredKeys.add('plugins').add('plugins:needs-ui');
    findings.push(...findPluginUpdates(plugins, i18n));
  }

  const previous = settings.ui.updateCheck.notified;
  const notified: Record<string, string> = {};
  // Записи опрошенных источников пересобираем: исчезнувшее обновление забывается,
  // и если оно вернётся (откат релиза), о нём скажут снова. Остальные не трогаем.
  for (const [key, version] of Object.entries(previous)) {
    if (!answeredKeys.has(key)) notified[key] = version;
  }
  for (const f of findings) {
    notified[f.key] = f.version;
    if (previous[f.key] === f.version) continue;
    notifications.push({
      // Новость про хост, а не про принтер: пустой printerId — без плашки принтера.
      printerId: '',
      pluginId: HOST_NOTIFICATION_SOURCE,
      severity: 'info',
      label: i18n.t('notifications.update.source'),
      text: f.text,
    });
  }

  settings.setUpdateCheckSettings({ lastCheckedAt: now, notified });
  return true;
}
