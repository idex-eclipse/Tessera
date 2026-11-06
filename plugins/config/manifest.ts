import type { PluginManifest } from '../../plugin-sdk/src/types';
import { fileTablePoints } from '../shared/file-table/extension-points';

export const configManifest: PluginManifest = {
  id: '@core/config',
  name: 'Config',
  version: '4.0.0',
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

  // Extensions embed into the page, its two file tables and a bottom panel area. All points are version 1.
  // Deliberately NOT extensible: the tabs of the right table (they map to fixed Moonraker roots),
  // the rename/delete dialogs, and the critical-file guard above (guards are not inherited).
  extensionPoints: [
    // the whole page content (both tables and the bottom panels)
    { id: 'page', kind: 'element', mode: 'replacement', version: 1, titleKey: 'config.ext.page' },
    // each table as a whole; the right one includes its tab strip
    { id: 'table-config', kind: 'element', mode: 'replacement', version: 1, titleKey: 'config.ext.tableConfig' },
    { id: 'table-other', kind: 'element', mode: 'replacement', version: 1, titleKey: 'config.ext.tableOther' },
    // extra panels at the very bottom of the page
    { id: 'panels-bottom', kind: 'panel', mode: 'append', version: 1, titleKey: 'config.ext.panelsBottom' },
    // file-actions, file-editor, file-viewer: the points of the shared FileTable
    ...fileTablePoints('config'),
  ],

  locales: ['en', 'ru'],
  defaultSettings: {},
};