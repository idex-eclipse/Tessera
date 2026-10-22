import type { PluginManifest } from '../../plugin-sdk/src/types';

export const gcodePreviewManifest: PluginManifest = {
  id: '@core/gcode-preview',
  name: 'G-code Preview',
  version: '1.1.0',
  entry: '/plugins/gcode-preview/index.js',
  pages: [
    { id: 'gcode-preview', titleKey: 'gcodePreview.title', icon: 'cube', element: 'mpu-gcode-preview-page', },
  ],
  widgets: [
  {
    type: 'gcode-preview',
    provider: '@core/gcode-preview',
    titleKey: 'gcodePreview.title',
    icon: 'preview',
    element: 'mpu-gcode-preview-widget',
    headerElement: 'mpu-gcode-preview-header',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
],
  locales: ['en', 'ru'],
  defaultSettings: {},
};