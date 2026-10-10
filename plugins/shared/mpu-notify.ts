import type { PluginApi } from '../../plugin-sdk/src/types';

export type MpuSeverity = 'critical' | 'error' | 'info';

/**
 * Отправить уведомление через M118 MPU_NOTIFY эхо-конвенцию.
 * Текст локализуется вызывающим плагином через api.i18n.t ДО вызова.
 * Отказ запроса тихо логируется — мониторы не должны спамить ретраями.
 */
export async function sendMpuNotify(
  api: PluginApi,
  severity: MpuSeverity,
  text: string,
): Promise<void> {
  const clean = String(text ?? '').replace(/[\r\n"']/g, '').slice(0, 180).trim();
  if (!clean) return;
  const script = `M118 MPU_NOTIFY ${severity} ${clean}`;
  try {
    await api.moonraker().request('printer.gcode.script', { script });
  } catch (e) {
    console.warn('[mpu-notify] send failed:', e);
  }
}