import type { PluginManifest } from '../../plugin-sdk/src/types';

export const configManifest: PluginManifest = {
  id: '@core/config',
  name: 'Config',
  version: '1.0.0',
  entry: '/plugins/config/index.js',
  pages: [
    { id: 'config', titleKey: 'config.title', icon: 'code', element: 'mpu-config-page' },
  ],
  locales: ['en', 'ru'],
  defaultSettings: {},
};