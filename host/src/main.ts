import { mount } from 'svelte';

import App from './App.svelte';

import { createHostI18n } from './core/host-i18n.svelte.ts';
import { createPluginLoader } from './core/plugin-loader.svelte.ts';
import { createPluginRegistry } from './core/plugin-registry.svelte.ts';
import { createPrinterManager } from './core/printer-manager.svelte.ts';
import { createRouter } from './core/router.svelte.ts';
import { createSettingsStore } from './core/settings-store.svelte.ts';
import { createUiStore } from './core/ui-store.svelte.ts';
import { guardAgent } from './core/guard-agent';

import { registerCoreLocales } from './i18n/index.ts';

import { widgetsCoreManifest } from '../../plugins/widgets-core/manifest';
import * as widgetsCoreModule from '../../plugins/widgets-core/index';
import { locales as widgetsCoreLocales } from '../../plugins/widgets-core/i18n';

import { consoleManifest } from '../../plugins/console/manifest';
import * as consoleModule from '../../plugins/console/index';
import { locales as consoleLocales } from '../../plugins/console/i18n';

import { jobsManifest } from '../../plugins/jobs/manifest';
import * as jobsModule from '../../plugins/jobs/index';
import { locales as jobsLocales } from '../../plugins/jobs/i18n';

import { gcodePreviewManifest } from '../../plugins/gcode-preview/manifest';
import * as gcodePreviewModule from '../../plugins/gcode-preview/index';
import { locales as gcodePreviewLocales } from '../../plugins/gcode-preview/i18n';

import { configManifest } from '../../plugins/config/manifest';
import * as configModule from '../../plugins/config/index';
import { locales as configLocales } from '../../plugins/config/i18n';

import { historyManifest } from '../../plugins/history/manifest';
import * as historyModule from '../../plugins/history/index';
import { locales as historyLocales } from '../../plugins/history/i18n';

import { systemManifest } from '../../plugins/system/manifest';
import * as systemModule from '../../plugins/system/index';
import { locales as systemLocales } from '../../plugins/system/i18n';

import { calibrationsManifest } from '../../plugins/calibrations/manifest';
import * as calibrationsModule from '../../plugins/calibrations/index';
import { locales as calibrationsLocales } from '../../plugins/calibrations/i18n';

import './styles/global.css';

const settings = createSettingsStore();
const printerManager = createPrinterManager(settings);
const registry = createPluginRegistry(settings);
const ui = createUiStore(settings);
const i18n = createHostI18n(ui);
const loader = createPluginLoader({
  settings,
  registry,
  i18n,
  guardAgent,
});
const router = createRouter({ settings, printerManager });

registerCoreLocales(i18n);

//loader.registerCorePlugin(dummyManifest, dummyModule);
loader.registerCorePlugin(widgetsCoreManifest, widgetsCoreModule);
loader.registerCorePlugin(consoleManifest, consoleModule);
loader.registerCorePlugin(jobsManifest, jobsModule);
loader.registerCorePlugin(historyManifest, historyModule);
loader.registerCorePlugin(gcodePreviewManifest, gcodePreviewModule);
loader.registerCorePlugin(calibrationsManifest, calibrationsModule);
loader.registerCorePlugin(configManifest, configModule);
loader.registerCorePlugin(systemManifest, systemModule);

function addPluginLocales(locales: Record<string, Record<string, unknown>>): void {
  for (const [locale, messages] of Object.entries(locales)) {
    i18n.addMessages(locale, messages as Record<string, any>);
  }
}

//addPluginLocales(dummyLocales);
addPluginLocales(widgetsCoreLocales);
addPluginLocales(consoleLocales);
addPluginLocales(jobsLocales);
addPluginLocales(gcodePreviewLocales);
addPluginLocales(configLocales);
addPluginLocales(historyLocales);
addPluginLocales(calibrationsLocales);
addPluginLocales(systemLocales);

async function startup(): Promise<void> {
  try {
    await loader.loadEnabledPlugins();
  } catch (e) {
    console.error('[main] Failed to load enabled remote plugins:', e);
  }

  // Гарантирует, что плагины с постоянными поверхностями активны
  // до первого рендера. Для core это no-op (уже в бандле), для remote —
  // документация и точка расширения (если в будущем появится ленивая оценка).
  loader.eagerActivateSurfacePlugins();

  mount(App, {
    target: document.getElementById('app')!,
    props: {
      settings,
      printerManager,
      registry,
      ui,
      i18n,
      loader,
      router,
    },
  });
}

startup();

export default App;