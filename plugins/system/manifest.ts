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
      titleKey: 'fleet.status.title',
    },
  ],

  guards: [
    {
      id: 'system-print-safety',
      match: [
        'printer.restart',
        'printer.firmware_restart',
        'machine.reboot',
        'machine.shutdown',
        'machine.update.*',
        'machine.services.restart',
        'machine.services.stop',
      ],
      handler: 'guardSystemPrintSafety',
    },
  ],

  hotkeys: [
    // N: открыть / закрыть центр уведомлений (в полях ввода не срабатывает)
    {
      id: 'toggle-notifications',
      scope: 'global',
      keys: 'N',
      handler: 'hotkeyToggleNotifications',
      titleKey: 'system.hotkeys.toggleNotifications',
    },
    // M: страница «Система» откуда угодно; Alt+R — обновить её данные
    {
      id: 'open-machine',
      scope: 'global',
      keys: 'M',
      handler: 'hotkeyOpenMachine',
      titleKey: 'system.hotkeys.openMachine',
    },
    // U: выбрать файл для загрузки; P: флажок «Начать печать после загрузки»
    {
      id: 'upload-file',
      scope: 'global',
      keys: 'U',
      handler: 'hotkeyUploadFile',
      titleKey: 'system.hotkeys.uploadFile',
    },
    {
      id: 'toggle-print-after',
      scope: 'global',
      keys: 'P',
      handler: 'hotkeyTogglePrintAfter',
      titleKey: 'system.hotkeys.togglePrintAfter',
    },
    {
      id: 'refresh-machine',
      scope: 'plugin',
      keys: 'Alt+R',
      handler: 'hotkeyRefreshMachine',
      titleKey: 'system.hotkeys.refresh',
    },
  ],

  locales: ['en', 'ru'],
});