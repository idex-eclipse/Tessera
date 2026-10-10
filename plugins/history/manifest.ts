import type { PluginManifest } from '../../plugin-sdk/src/types';

export const historyManifest: PluginManifest = {
  id: 'history',
  name: 'History',
  version: '1.0.0',
  entry: '/plugins/history/index.js',
  locales: ['en', 'ru'],
  pages: [
    { id: 'history', titleKey: 'history.title', icon: 'history', element: 'mpu-history-page' },
  ],
};