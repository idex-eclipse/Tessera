import type { PluginApi } from '../../plugin-sdk/src/types';
import { configRestartMonitor, type RestartAttempt } from '../shared/file-table/config-restart-monitor';

/**
 * Publish one actionable Config failure notification for a completed restart check.
 * @param api Config plugin API that owns the notification actions.
 * @param printerId Printer whose attempt failed.
 * @param attempt Persisted restart attempt, if one is active.
 */
export function notifyConfigRestartFailure(api: PluginApi, printerId: string, attempt: RestartAttempt | null): void {
  if (attempt?.phase !== 'failed' || attempt.notified) return;
  const monitor = configRestartMonitor(printerId, api.moonrakerFor(printerId));
  monitor.markNotified(attempt.id);
  api.notifications.push({
    printerId,
    severity: 'error',
    label: api.i18n.t('config.restartTitle'),
    text: (attempt.files?.length ?? 1) > 1
      ? api.i18n.t('config.restartFailedNoticeMany', { count: attempt.files!.length })
      : api.i18n.t('config.restartFailedNotice', { file: attempt.file.path }),
    actions: [
      { element: 'mpu-config-notification-page-action', params: {
        printerId, pageId: 'config', labelKey: 'config.restartOpenConfig',
      } },
      ...(attempt.backup ? [{ element: 'mpu-config-restart-restore-action', params: {
        printerId, attemptId: attempt.id,
      } }] : []),
    ],
  });
}

/** Tell the owner that a saved moonraker.conf still needs its separate service restart. */
export function notifyMoonrakerRestartNeeded(api: PluginApi, printerId: string): void {
  api.notifications.push({
    printerId, severity: 'info', label: api.i18n.t('config.title'),
    text: api.i18n.t('config.moonrakerRestartNeeded'),
  });
}

/** Report a rejected Moonraker restart after the editor session has closed. */
export function notifyMoonrakerRestartError(api: PluginApi, printerId: string, error: unknown): void {
  api.notifications.push({
    printerId, severity: 'error', label: api.i18n.t('config.title'),
    text: error instanceof Error ? error.message : String(error),
  });
}
