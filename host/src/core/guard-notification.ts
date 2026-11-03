import type { GuardNotifyDetail } from './guard-agent';
import type { HostI18n } from './host-i18n.svelte.ts';
import { HOST_NOTIFICATION_SOURCE, type NotificationPush } from './notification-center.svelte.ts';

/** Fail-closed событие гарда → уведомление центра (текст локализуется сейчас). */
export function guardNotification(d: GuardNotifyDetail, i18n: Pick<HostI18n, 't'>): NotificationPush {
  const text =
    d.kind === 'park_timeout'
      ? i18n.t('notifications.guard.parkTimeout', { method: d.method })
      : d.kind === 'decision_timeout'
        ? i18n.t('notifications.guard.decisionTimeout', {
            guard: d.guardId,
            plugin: d.pluginId,
            method: d.method,
          })
        : d.reasonKey
          ? i18n.t(d.reasonKey)
          : i18n.t('notifications.guard.denied', { plugin: d.pluginId, method: d.method });

  return {
    printerId: d.targetPrinterId,
    pluginId: HOST_NOTIFICATION_SOURCE,
    severity: 'error',
    label: i18n.t('notifications.guard.source'),
    text,
  };
}
