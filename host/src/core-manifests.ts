import type { PluginManifest } from '../../plugin-sdk/src/types';

import { calibrationsManifest } from '../../plugins/calibrations/manifest';
import { configManifest } from '../../plugins/config/manifest';
import { consoleManifest } from '../../plugins/console/manifest';
import { gcodePreviewManifest } from '../../plugins/gcode-preview/manifest';
import { historyManifest } from '../../plugins/history/manifest';
import { jobsManifest } from '../../plugins/jobs/manifest';
import { systemManifest } from '../../plugins/system/manifest';
import { widgetsCoreManifest } from '../../plugins/widgets-core/manifest';

/**
 * Манифесты встроенных плагинов — без модулей, только данные. vite.config.ts пишет по ним
 * core-plugins.json (id → version) рядом со сборкой: deploy/tessera-ext.py сверяет с ним
 * manifest.dependencies дополнений на @core/*. Регистрирует плагины main.ts; тест сверяет,
 * что здесь все plugins/<name>/manifest.ts.
 */
export const CORE_MANIFESTS: readonly PluginManifest[] = [
  widgetsCoreManifest,
  consoleManifest,
  jobsManifest,
  historyManifest,
  gcodePreviewManifest,
  calibrationsManifest,
  configManifest,
  systemManifest,
];

/** Содержимое core-plugins.json. */
export function corePluginVersions(): Record<string, string> {
  return Object.fromEntries(CORE_MANIFESTS.map((m) => [m.id, m.version]));
}
