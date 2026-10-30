import { definePlugin } from '../../plugin-sdk/src/define-plugin';

export const calibrationsManifest = definePlugin({
  id: '@core/calibrations',
  name: 'Calibrations',
  version: '2.1.0',
  entry: '/plugins/calibrations/index.js',

  pages: [
    {
      id: 'calibrations',
      titleKey: 'calibrations.pageTitle',
      icon: 'sliders',
      element: 'mpu-calibrations-page',
    },
  ],

  widgets: [
    {
      type: 'calibrations',
      provider: '@core/calibrations',
      titleKey: 'calibrations.widgetTitle',
      icon: 'sliders',
      element: 'mpu-calibrations-widget',
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
    },
    {
      type: 'bed-mesh',
      provider: '@core/calibrations',
      titleKey: 'bedMesh.widgetTitle',
      icon: 'grid',
      element: 'mpu-bed-mesh-widget',
      headerElement: 'mpu-bed-mesh-widget-header',
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 2 },
    },
  ],

  overlays: [
    { id: 'test-z', element: 'mpu-test-z-overlay' },
    { id: 'screws-tilt', element: 'mpu-screws-tilt-overlay' },
  ],

  chips: [
    {
      type: 'livez',
      provider: '@core/calibrations',
      titleKey: 'calibrations.liveZ.chipSection',
      element: 'mpu-core-calibrations-chip-livez',
      pickerElement: 'mpu-core-calibrations-chip-livez-picker',
      icon: 'kind-tuning',
    },
  ],

  guards: [
    {
      id: 'calib-safety',
      match: ['printer.gcode.script'],
      handler: 'guardCalibScript',
    },
    {
      id: 'calib-print-start',
      match: ['printer.print.start'],
      handler: 'guardCalibPrintStart',
    },
  ],

  hotkeys: [
    // открыть страницу плагина с любой страницы
    { id: 'open-calibrations', scope: 'global', keys: 'Shift+A', handler: 'hotkeyOpenCalibrations', titleKey: 'calibrations.hotkeys.open' },
    // страница калибровок: вкладки
    { id: 'tab-mesh', scope: 'plugin', keys: 'Alt+1', handler: 'hotkeyTabMesh', titleKey: 'calibrations.hotkeys.tabMesh' },
    { id: 'tab-probe', scope: 'plugin', keys: 'Alt+2', handler: 'hotkeyTabProbe', titleKey: 'calibrations.hotkeys.tabProbe' },
    { id: 'tab-heaters', scope: 'plugin', keys: 'Alt+3', handler: 'hotkeyTabHeaters', titleKey: 'calibrations.hotkeys.tabHeaters' },
    { id: 'tab-shaper', scope: 'plugin', keys: 'Alt+4', handler: 'hotkeyTabShaper', titleKey: 'calibrations.hotkeys.tabShaper' },

    // ручное зондирование (оверлей TEST_Z виден на любой странице → global)
    { id: 'testz-up', scope: 'global', keys: 'Alt+ArrowUp', handler: 'hotkeyTestzUp', titleKey: 'calibrations.hotkeys.testzUp' },
    { id: 'testz-down', scope: 'global', keys: 'Alt+ArrowDown', handler: 'hotkeyTestzDown', titleKey: 'calibrations.hotkeys.testzDown' },
    { id: 'testz-up-fine', scope: 'global', keys: 'Alt+Shift+ArrowUp', handler: 'hotkeyTestzUpFine', titleKey: 'calibrations.hotkeys.testzUpFine' },
    { id: 'testz-down-fine', scope: 'global', keys: 'Alt+Shift+ArrowDown', handler: 'hotkeyTestzDownFine', titleKey: 'calibrations.hotkeys.testzDownFine' },
    { id: 'probe-accept', scope: 'global', keys: 'Alt+Enter', handler: 'hotkeyProbeAccept', titleKey: 'calibrations.hotkeys.probeAccept' },
    { id: 'probe-abort', scope: 'global', keys: 'Alt+Backspace', handler: 'hotkeyProbeAbort', titleKey: 'calibrations.hotkeys.probeAbort' },
  ],

  locales: ['en', 'ru'],

  defaultSettings: {
    shaperCmdX: 'generate_x_shaper_graph',
    shaperCmdY: 'generate_y_shaper_graph',
    beltsEnabled: false,
    beltsKinematics: 'auto',
    beltsCmd: 'generate_belts_graph',
    beltsForceShow: false,
    'view:exaggeration': 10,
    'view:interpolated': true,
    'view:basePlane': true,
    'view:wireframe': false,
  },
});