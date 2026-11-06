import type { PluginManifest } from '../../plugin-sdk/src/types';

export const historyManifest: PluginManifest = {
  id: '@core/history',
  name: 'History',
  version: '4.0.0',
  entry: '/plugins/history/index.js',
  guards: [
    {
      id: 'history-owner-only',
      match: ['server.history.delete_job', 'server.history.delete_all', 'server.history.reset_totals'],
      handler: 'guardHistoryOwnerOnly',
    },
  ],
  hotkeys: [
    // открыть страницу плагина с любой страницы
    { id: 'open-history', scope: 'global', keys: 'H', handler: 'hotkeyOpenHistory', titleKey: 'history.hotkeys.open' },
    // Ctrl+F вместо поиска браузера → поиск по истории; Alt+R → обновить таблицу и статистику
    { id: 'find-history', scope: 'plugin', keys: 'Ctrl+F', handler: 'hotkeyFindHistory', titleKey: 'history.hotkeys.find' },
    { id: 'refresh-history', scope: 'plugin', keys: 'Alt+R', handler: 'hotkeyRefreshHistory', titleKey: 'history.hotkeys.refresh' },
  ],
  // Extensions embed into the page: the whole content, each of the two panels, and an area for extra panels.
  // All points are version 1. The shared FileTable points (file-actions, file-editor, file-viewer) are
  // deliberately NOT declared: the history table has no file operations, so there is nothing to extend,
  // and an undeclared point just renders the built-in behavior.
  extensionPoints: [
    // the whole page content (both panels and the bottom panels)
    { id: 'page', kind: 'element', mode: 'replacement', version: 1, titleKey: 'history.ext.page' },
    // 'element', not 'panel': both panels draw their own card, a host panel shell would double the chrome
    { id: 'panel-stats', kind: 'element', mode: 'replacement', version: 1, titleKey: 'history.ext.panelStats' },
    { id: 'panel-history', kind: 'element', mode: 'replacement', version: 1, titleKey: 'history.ext.panelHistory' },
    // extra panels at the very bottom of the page
    { id: 'panels-bottom', kind: 'panel', mode: 'append', version: 1, titleKey: 'history.ext.panelsBottom' },
  ],
  locales: ['en', 'ru'],
  pages: [
    { id: 'history', titleKey: 'history.title', icon: 'history', element: 'mpu-history-page' },
  ],
};