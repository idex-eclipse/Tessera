import { definePlugin } from '../../plugin-sdk/src/define-plugin';

export const calibrationsManifest = definePlugin({
  id: '@core/calibrations',
  name: 'Calibrations',
  version: '4.0.0',
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
    // Arrow shortcuts follow only rendered tabs and reverse their logical step in RTL.
    { id: 'tab-left', scope: 'plugin', keys: 'Alt+ArrowLeft', handler: 'hotkeyTabLeft', titleKey: 'calibrations.hotkeys.tabLeft' },
    { id: 'tab-right', scope: 'plugin', keys: 'Alt+ArrowRight', handler: 'hotkeyTabRight', titleKey: 'calibrations.hotkeys.tabRight' },

    // ручное зондирование (оверлей TEST_Z виден на любой странице → global)
    { id: 'testz-up', scope: 'global', keys: 'Alt+ArrowUp', handler: 'hotkeyTestzUp', titleKey: 'calibrations.hotkeys.testzUp' },
    { id: 'testz-down', scope: 'global', keys: 'Alt+ArrowDown', handler: 'hotkeyTestzDown', titleKey: 'calibrations.hotkeys.testzDown' },
    { id: 'testz-up-fine', scope: 'global', keys: 'Alt+Shift+ArrowUp', handler: 'hotkeyTestzUpFine', titleKey: 'calibrations.hotkeys.testzUpFine' },
    { id: 'testz-down-fine', scope: 'global', keys: 'Alt+Shift+ArrowDown', handler: 'hotkeyTestzDownFine', titleKey: 'calibrations.hotkeys.testzDownFine' },
    { id: 'probe-accept', scope: 'global', keys: 'Alt+Enter', handler: 'hotkeyProbeAccept', titleKey: 'calibrations.hotkeys.probeAccept' },
    { id: 'probe-abort', scope: 'global', keys: 'Alt+Backspace', handler: 'hotkeyProbeAbort', titleKey: 'calibrations.hotkeys.probeAbort' },
  ],

  // Дополнения (внешние плагины) встраиваются вкладками, панелями, телами виджетов и оверлеями.
  extensionPoints: [
    // страница: вкладки
    { id: 'tabs', kind: 'tab', mode: 'append', version: 1, titleKey: 'calibrations.ext.tabs' },
    { id: 'shaper', kind: 'tab', mode: 'alternative', version: 1, titleKey: 'calibrations.ext.shaper' },

    // страница: замена панели целиком
    { id: 'panel-mesh-map', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.panelMeshMap' },
    { id: 'panel-mesh-profiles', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.panelMeshProfiles' },
    { id: 'panel-mesh-tools', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.panelMeshTools' },
    { id: 'panel-probe', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.panelProbe' },
    { id: 'panel-heaters', kind: 'panel', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.panelHeaters' },
    // вкладка шейперов: панели дополняют друг друга и штатные калибровки Klipper, поэтому выбор, а не замена
    { id: 'panel-shaper', kind: 'panel', mode: 'alternative', version: 1, titleKey: 'calibrations.ext.panelShaper' },
    { id: 'panel-belts', kind: 'panel', mode: 'alternative', version: 1, titleKey: 'calibrations.ext.panelBelts' },
    { id: 'panel-graphs', kind: 'panel', mode: 'alternative', version: 1, titleKey: 'calibrations.ext.panelGraphs' },

    // страница: свои панели рядом с имеющимися, по вкладке
    { id: 'panels-mesh', kind: 'panel', mode: 'append', version: 1, titleKey: 'calibrations.ext.panelsMesh' },
    { id: 'panels-probe', kind: 'panel', mode: 'append', version: 1, titleKey: 'calibrations.ext.panelsProbe' },
    { id: 'panels-heaters', kind: 'panel', mode: 'append', version: 1, titleKey: 'calibrations.ext.panelsHeaters' },
    { id: 'panels-shaper', kind: 'panel', mode: 'append', version: 1, titleKey: 'calibrations.ext.panelsShaper' },

    // виджет Calibrations: тела вкладок и свои вкладки
    { id: 'widget-livez', kind: 'element', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.widgetLivez' },
    { id: 'widget-probe', kind: 'element', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.widgetProbe' },
    { id: 'widget-pid', kind: 'element', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.widgetPid' },
    { id: 'widget-tabs', kind: 'tab', mode: 'append', version: 1, titleKey: 'calibrations.ext.widgetTabs' },

    // виджет bed-mesh: всё содержимое
    { id: 'widget-bed-mesh', kind: 'element', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.widgetBedMesh' },

    // оверлеи: всё содержимое (видимостью управляет плагин)
    { id: 'overlay-test-z', kind: 'element', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.overlayTestZ' },
    { id: 'overlay-screws-tilt', kind: 'element', mode: 'replacement', version: 1, titleKey: 'calibrations.ext.overlayScrewsTilt' },
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
    'probe:forceOpen': false,
    'probe:forceSeconds': 30,
    'probe:forceFilter': 'raw',
    'probe:forceFilterMs': 100,
    'probe:forceRaw': false,
  },
});
