import type { PluginManifest } from '../../plugin-sdk/src/types';

export const consoleManifest: PluginManifest = {
  id: '@core/console',
  name: 'Console',
  version: '2.0.0',
  entry: '/plugins/console/index.js',
  pages: [
    {
      id: 'console',
      titleKey: 'console.title',
      icon: 'terminal',
      element: 'mpu-console-page' 
    },
  ],
  widgets: [
    {
      type: 'console',
      provider: '@core/console',
      titleKey: 'console.title',
      icon: 'terminal',
      element: 'mpu-console-widget',
      headerElement: 'mpu-console-widget-header',
      defaultSize: { w: 6, h: 4 },
      minSize: { w: 4, h: 3 },
    },
  ],
  hotkeys: [
    // C - открыть страницу плагина с любой страницы
    { id: 'open-console', scope: 'global', keys: 'C', handler: 'hotkeyOpenConsole', titleKey: 'console.hotkeys.open' },
    // Alt-комбинации работают и из поля ввода команды
    { id: 'focus-input', scope: 'plugin', keys: 'Alt+I', handler: 'hotkeyFocusInput', titleKey: 'console.hotkeys.focusInput' },
    { id: 'clear-log', scope: 'plugin', keys: 'Alt+C', handler: 'hotkeyClear', titleKey: 'console.hotkeys.clear' },
    { id: 'refresh-log', scope: 'plugin', keys: 'Alt+R', handler: 'hotkeyRefresh', titleKey: 'console.hotkeys.refresh' },
    { id: 'toggle-autoscroll', scope: 'plugin', keys: 'Alt+S', handler: 'hotkeyToggleAutoscroll', titleKey: 'console.hotkeys.autoscroll' },
    { id: 'toggle-reverse', scope: 'plugin', keys: 'Alt+O', handler: 'hotkeyToggleReverse', titleKey: 'console.hotkeys.reverse' },
    { id: 'toggle-filters', scope: 'plugin', keys: 'Alt+F', handler: 'hotkeyToggleFilters', titleKey: 'console.hotkeys.filters' },
  ],
  locales: ['en', 'ru'],
  defaultSettings: {},
};