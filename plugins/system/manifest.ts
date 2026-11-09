import { definePlugin } from '../../plugin-sdk/src/define-plugin';

export const systemManifest = definePlugin({
  id: '@core/system',
  name: 'System',
  version: '5.1.0',
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

  collapsedBanners: [
    {
      id: 'klipper-state-collapsed',
      banner: 'klipper-state',
      element: 'mpu-system-state-banner-collapsed',
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
    // Alt+1/2/3: вкладки страницы (как в Calibrations)
    {
      id: 'tab-overview',
      scope: 'plugin',
      keys: 'Alt+1',
      handler: 'hotkeyTabOverview',
      titleKey: 'system.hotkeys.tabOverview',
    },
    {
      id: 'tab-monitoring',
      scope: 'plugin',
      keys: 'Alt+2',
      handler: 'hotkeyTabMonitoring',
      titleKey: 'system.hotkeys.tabMonitoring',
    },
    {
      id: 'tab-maintenance',
      scope: 'plugin',
      keys: 'Alt+3',
      handler: 'hotkeyTabMaintenance',
      titleKey: 'system.hotkeys.tabMaintenance',
    },
    // Arrow shortcuts follow the complete visual row and reverse their logical step in RTL.
    {
      id: 'tab-left',
      scope: 'plugin',
      keys: 'Alt+ArrowLeft',
      handler: 'hotkeyTabLeft',
      titleKey: 'system.hotkeys.tabLeft',
    },
    {
      id: 'tab-right',
      scope: 'plugin',
      keys: 'Alt+ArrowRight',
      handler: 'hotkeyTabRight',
      titleKey: 'system.hotkeys.tabRight',
    },
  ],

  // Extensions embed into the Machine page, the Status widget, the banners and the right panel.
  // Deliberately NOT extensible: the E-stop button, upload & print, and Pause/Resume/Cancel
  // (print controls must never be replaceable, see docs/en/surfaces.md). All points are version 1.
  extensionPoints: [
    // page: extra tabs next to the built-in ones
    { id: 'tabs', kind: 'tab', mode: 'append', version: 1, titleKey: 'system.ext.tabs' },

    // page: the whole body of a built-in tab (the tab button itself stays)
    { id: 'tab-overview', kind: 'tab', mode: 'replacement', version: 1, titleKey: 'system.ext.tabOverview' },
    { id: 'tab-monitoring', kind: 'tab', mode: 'replacement', version: 1, titleKey: 'system.ext.tabMonitoring' },
    { id: 'tab-maintenance', kind: 'tab', mode: 'replacement', version: 1, titleKey: 'system.ext.tabMaintenance' },

    // page: replacement of a large panel, per tab
    { id: 'panel-info', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelInfo' },
    { id: 'panel-sd', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelSd' },
    { id: 'panel-charts', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelCharts' },
    { id: 'panel-host', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelHost' },
    { id: 'panel-mcu', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelMcu' },
    { id: 'panel-tmc', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelTmc' },
    { id: 'panel-storage', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelStorage' },
    { id: 'panel-database', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelDatabase' },
    { id: 'panel-updates', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'system.ext.panelUpdates' },

    // page: own panels at the end of a built-in tab
    { id: 'panels-overview', kind: 'panel', mode: 'append', version: 1, titleKey: 'system.ext.panelsOverview' },
    { id: 'panels-monitoring', kind: 'panel', mode: 'append', version: 1, titleKey: 'system.ext.panelsMonitoring' },
    { id: 'panels-maintenance', kind: 'panel', mode: 'append', version: 1, titleKey: 'system.ext.panelsMaintenance' },

    // Status widget: the whole content (the header stays)
    { id: 'widget-status', kind: 'element', mode: 'replacement', version: 1, titleKey: 'system.ext.widgetStatus' },

    // banners: the whole body (the plugin still decides WHEN a banner is shown)
    { id: 'banner-status', kind: 'element', mode: 'replacement', version: 1, titleKey: 'system.ext.bannerStatus' },
    { id: 'banner-klipper-error', kind: 'element', mode: 'replacement', version: 1, titleKey: 'system.ext.bannerKlipperError' },
    { id: 'banner-status-collapsed', kind: 'element', mode: 'replacement', version: 1, titleKey: 'system.ext.bannerStatusCollapsed' },
    { id: 'banner-klipper-error-collapsed', kind: 'element', mode: 'replacement', version: 1, titleKey: 'system.ext.bannerKlipperErrorCollapsed' },

    // Status banner while printing: progress and ETA are replaceable, buttons only extendable.
    // The action context is { state: 'printing' | 'paused', filename: string }.
    { id: 'banner-status-progress', kind: 'element', mode: 'replacement', version: 1, titleKey: 'system.ext.bannerStatusProgress' },
    { id: 'banner-status-eta', kind: 'element', mode: 'replacement', version: 1, titleKey: 'system.ext.bannerStatusEta' },
    { id: 'banner-status-actions', kind: 'action', mode: 'append', version: 1, titleKey: 'system.ext.bannerStatusActions' },

    // right panel: own sections after the built-in ones (expanded view only)
    { id: 'panels-right', kind: 'panel', mode: 'append', version: 1, titleKey: 'system.ext.panelsRight' },
  ],

  locales: ['en', 'ru'],
});
