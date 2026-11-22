import type { PluginApi } from '../../plugin-sdk/src/types.ts';

/**
 * Publishes a printer-scoped filament loss detected by the persistent monitor.
 * @param api The Core Widgets API that owns the notification.
 * @param printerId The printer whose enabled sensor lost filament.
 * @param sensorName The configured sensor name shown to the user.
 * @returns Nothing.
 */
export function publishFilamentRunout(api: PluginApi, printerId: string, sensorName: string): void {
  const printer = api.printers.find((item) => item.id === printerId)?.name ?? printerId;
  api.notifications.push({
    printerId,
    severity: 'critical',
    label: api.i18n.t('widgets.filament.title'),
    text: api.i18n.t('fleet.filament.runout', { printer, sensor: sensorName }),
  });
}
