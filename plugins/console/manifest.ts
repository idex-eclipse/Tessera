import type { PluginManifest } from '../../plugin-sdk/src/types';

export const consoleManifest: PluginManifest = {
  id: '@core/console',
  name: 'Console',
  version: '1.0.0',
  entry: '/plugins/console/index.js',
  pages: [
    {
      id: 'console',
      titleKey: 'console.title',
      icon: 'terminal',
      element: 'mpu-console-page' 
    },
  ],
  widgets: [
    {
      type: 'console',
      provider: '@core/console',
      titleKey: 'console.title',
      icon: 'terminal',
      element: 'mpu-console-widget',
      headerElement: 'mpu-console-widget-header',
      defaultSize: { w: 6, h: 4 },
      minSize: { w: 4, h: 3 },
    },
  ],
  locales: ['en', 'ru'],
  defaultSettings: {},
};