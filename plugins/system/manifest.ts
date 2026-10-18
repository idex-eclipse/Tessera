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

  widgets: [
    {
      type: 'status',
      provider: '@core/widgets',
      titleKey: 'system.status.title',
      element: 'mpu-widgets-status',
      headerElement: 'mpu-widgets-status-header',
      defaultSize: { w: 4, h: 2 },
      minSize: { w: 3, h: 2 },
    },
  ],

  overlays: [
    { id: 'notifications', element: 'mpu-system-notifications' },
  ],

  banners: [
    {
      id: 'klipper-state',
      element: 'mpu-system-state-banner',
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

  printerPanels: [
    {
      id: 'fleet-status',
      element: 'mpu-system-fleet-status',
      titleKey: 'system.fleet.status.title',
    },
  ],

  locales: ['en', 'ru'],
});