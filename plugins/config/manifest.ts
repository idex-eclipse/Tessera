import type { PluginManifest } from '../../plugin-sdk/src/types';

export const configManifest: PluginManifest = {
  id: '@core/config',
  name: 'Config',
  version: '2.0.0',
  entry: '/plugins/config/index.js',
  pages: [
    { id: 'config', titleKey: 'config.title', icon: 'code', element: 'mpu-config-page' },
  ],
  guards: [
    {
      id: 'config-critical-files',
      match: [
        'server.files.delete_file',
        'server.files.delete_directory',
        'server.files.move',
        'server.files.copy',
      ],
      handler: 'guardCriticalConfig',
    },
  ],

  hotkeys: [
    // открыть страницу плагина с любой страницы
    { id: 'open-config', scope: 'global', keys: 'Shift+C', handler: 'hotkeyOpenConfig', titleKey: 'config.hotkeys.open' },
    // Ctrl+F вместо поиска браузера → поиск файлов; Alt+L/D/C → вкладки правой таблицы
    { id: 'find-file', scope: 'plugin', keys: 'Ctrl+F', handler: 'hotkeyFindFile', titleKey: 'config.hotkeys.find' },
    { id: 'tab-logs', scope: 'plugin', keys: 'Alt+L', handler: 'hotkeyTabLogs', titleKey: 'config.hotkeys.tabLogs' },
    { id: 'tab-docs', scope: 'plugin', keys: 'Alt+D', handler: 'hotkeyTabDocs', titleKey: 'config.hotkeys.tabDocs' },
    { id: 'tab-examples', scope: 'plugin', keys: 'Alt+C', handler: 'hotkeyTabExamples', titleKey: 'config.hotkeys.tabExamples' },
  ],

  locales: ['en', 'ru'],
  defaultSettings: {},
};