import type { PluginManifest } from '../../plugin-sdk/src/types';

export const dummyManifest: PluginManifest = {
  id: '@core/dummy',
  name: 'Dummy Plugin',
  version: '1.0.0',
  entry: '/plugins/dummy/index.js',
  pages: [],
  widgets: [
    {
      type: 'dummy',
      provider: '@core/dummy',
      titleKey: 'dummy.title',
      element: 'mpu-dummy-widget',
      defaultSize: { w: 4, h: 3 },
    },
  ],
  locales: ['en', 'ru'],
  defaultSettings: {},
  banners: [
    {
      id: 'dummy-banner',
      element: 'mpu-dummy-banner',
    },
  ],

  overlays: [
    {
      id: 'dummy-overlay',
      element: 'mpu-dummy-overlay',
    },
  ],
}
