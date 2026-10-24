import type { PluginManifest } from '../../plugin-sdk/src/types';

export const historyManifest: PluginManifest = {
  id: 'history',
  name: 'History',
  version: '2.0.0',
  entry: '/plugins/history/index.js',
  guards: [
    {
      id: 'history-owner-only',
      match: ['server.history.delete_job', 'server.history.delete_all', 'server.history.reset_totals'],
      handler: 'guardHistoryOwnerOnly',
    },
  ],
  hotkeys: [
    // Ctrl+F вместо поиска браузера → поиск по истории; Alt+R → обновить таблицу и статистику
    { id: 'find-history', scope: 'plugin', keys: 'Ctrl+F', handler: 'hotkeyFindHistory', titleKey: 'history.hotkeys.find' },
    { id: 'refresh-history', scope: 'plugin', keys: 'Alt+R', handler: 'hotkeyRefreshHistory', titleKey: 'history.hotkeys.refresh' },
  ],
  locales: ['en', 'ru'],
  pages: [
    { id: 'history', titleKey: 'history.title', icon: 'history', element: 'mpu-history-page' },
  ],
};