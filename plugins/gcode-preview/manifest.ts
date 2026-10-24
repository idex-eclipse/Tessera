import type { PluginManifest } from '../../plugin-sdk/src/types';

export const gcodePreviewManifest: PluginManifest = {
  id: '@core/gcode-preview',
  name: 'G-code Preview',
  version: '2.0.0',
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
  hotkeys: [
    // G: страница предпросмотра откуда угодно
    { id: 'open-preview', scope: 'global', keys: 'G', handler: 'hotkeyOpenPreview', titleKey: 'gcodePreview.hotkeys.open' },
    // Alt-комбинации — только на странице предпросмотра
    { id: 'layer-up', scope: 'plugin', keys: 'Alt+PageUp', handler: 'hotkeyLayerUp', titleKey: 'gcodePreview.hotkeys.layerUp' },
    { id: 'layer-down', scope: 'plugin', keys: 'Alt+PageDown', handler: 'hotkeyLayerDown', titleKey: 'gcodePreview.hotkeys.layerDown' },
    { id: 'layer-up-10', scope: 'plugin', keys: 'Alt+Shift+PageUp', handler: 'hotkeyLayerUp10', titleKey: 'gcodePreview.hotkeys.layerUp10' },
    { id: 'layer-down-10', scope: 'plugin', keys: 'Alt+Shift+PageDown', handler: 'hotkeyLayerDown10', titleKey: 'gcodePreview.hotkeys.layerDown10' },
    { id: 'layer-first', scope: 'plugin', keys: 'Alt+Home', handler: 'hotkeyLayerFirst', titleKey: 'gcodePreview.hotkeys.layerFirst' },
    { id: 'layer-last', scope: 'plugin', keys: 'Alt+End', handler: 'hotkeyLayerLast', titleKey: 'gcodePreview.hotkeys.layerLast' },
    { id: 'toggle-travel', scope: 'plugin', keys: 'Alt+T', handler: 'hotkeyToggleTravel', titleKey: 'gcodePreview.hotkeys.travel' },
    { id: 'toggle-bounds', scope: 'plugin', keys: 'Alt+B', handler: 'hotkeyToggleBounds', titleKey: 'gcodePreview.hotkeys.bounds' },
    { id: 'toggle-mode', scope: 'plugin', keys: 'Alt+M', handler: 'hotkeyToggleMode', titleKey: 'gcodePreview.hotkeys.mode' },
    { id: 'toggle-follow', scope: 'plugin', keys: 'Alt+F', handler: 'hotkeyToggleFollow', titleKey: 'gcodePreview.hotkeys.follow' },
    { id: 'toggle-color', scope: 'plugin', keys: 'Alt+C', handler: 'hotkeyToggleColor', titleKey: 'gcodePreview.hotkeys.color' },
    { id: 'clear-preview', scope: 'plugin', keys: 'Alt+X', handler: 'hotkeyClearPreview', titleKey: 'gcodePreview.hotkeys.clear' },
    { id: 'reload-preview', scope: 'plugin', keys: 'Alt+R', handler: 'hotkeyReloadPreview', titleKey: 'gcodePreview.hotkeys.reload' },
  ],
  locales: ['en', 'ru'],
  defaultSettings: {},
};