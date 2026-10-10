import { definePlugin } from '../../plugin-sdk/src/define-plugin';

export const systemManifest = definePlugin({
  id: '@core/system',
  name: 'System',
  version: '1.0.0',
  entry: '/plugins/system/index.js',

  pages: [
    {
      id: 'machine',
      titleKey: 'system.pageTitle',
      icon: 'server',
      element: 'mpu-system-page',
    },
  ],

  overlays: [
    { id: 'notifications', element: 'mpu-system-notifications' },
  ],

  banners: [
    {
      id: 'klipper-state',
      element: 'mpu-klipper-state-banner',
      scope: 'all',
    },
  ],

  chips: [
    {
      type: 'power',
      provider: '@core/system',
      titleKey: 'system.power.chipSection',
      element: 'mpu-core-system-chip-power',
      pickerElement: 'mpu-core-system-chip-power-picker',
      icon: 'kind-power',
    },
  ],

  rightPanel: {
    id: 'system-right',
    element: 'mpu-system-right-panel',
  },

  locales: ['en', 'ru'],
});