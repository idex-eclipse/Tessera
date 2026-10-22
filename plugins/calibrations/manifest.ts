import { definePlugin } from '../../plugin-sdk/src/define-plugin';

export const calibrationsManifest = definePlugin({
  id: '@core/calibrations',
  name: 'Calibrations',
  version: '1.1.1',
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