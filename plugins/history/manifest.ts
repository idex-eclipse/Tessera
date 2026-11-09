import type { PluginManifest } from '../../plugin-sdk/src/types';

export const historyManifest: PluginManifest = {
  id: '@core/history',
  name: 'History',
  version: '4.2.0',
  entry: '/plugins/history/index.js',
  guards: [
    {
      id: 'history-owner-only',
      match: ['server.history.delete_job', 'server.history.reset_totals'],
      handler: 'guardHistoryOwnerOnly',
    },
  ],
  hotkeys: [
    // The global shortcut opens History from any page.
    { id: 'open-history', scope: 'global', keys: 'H', handler: 'hotkeyOpenHistory', titleKey: 'history.hotkeys.open' },
    // Page shortcuts replace browser search and refresh both retained data sets.
    { id: 'find-history', scope: 'plugin', keys: 'Ctrl+F', handler: 'hotkeyFindHistory', titleKey: 'history.hotkeys.find' },
    { id: 'refresh-history', scope: 'plugin', keys: 'Alt+R', handler: 'hotkeyRefreshHistory', titleKey: 'history.hotkeys.refresh' },
    // Digit shortcuts select built-ins; arrows follow the complete visual tab row.
    { id: 'tab-history', scope: 'plugin', keys: 'Alt+1', handler: 'hotkeyTabHistory', titleKey: 'history.hotkeys.tabHistory' },
    { id: 'tab-statistics', scope: 'plugin', keys: 'Alt+2', handler: 'hotkeyTabStatistics', titleKey: 'history.hotkeys.tabStatistics' },
    { id: 'tab-left', scope: 'plugin', keys: 'Alt+ArrowLeft', handler: 'hotkeyTabLeft', titleKey: 'history.hotkeys.tabLeft' },
    { id: 'tab-right', scope: 'plugin', keys: 'Alt+ArrowRight', handler: 'hotkeyTabRight', titleKey: 'history.hotkeys.tabRight' },
  ],
  // Extensions embed into the page: the whole content, either tab body, and an area for extra panels.
  // All points are version 1. The shared FileTable points (file-actions, file-editor, file-viewer) are
  // deliberately NOT declared: the history table has no file operations, so there is nothing to extend,
  // and an undeclared point just renders the built-in behavior.
  extensionPoints: [
    // The page point includes both tab bodies and the bottom panels.
    { id: 'page', kind: 'element', mode: 'replacement', version: 1, titleKey: 'history.ext.page' },
    // Extensions can add full-height tabs after the two built-in tabs.
    { id: 'tabs', kind: 'tab', mode: 'append', version: 1, titleKey: 'history.ext.tabs' },
    // These are elements because the page-level tab card already owns the visual chrome.
    { id: 'panel-stats', kind: 'element', mode: 'replacement', version: 1, titleKey: 'history.ext.panelStats' },
    { id: 'panel-history', kind: 'element', mode: 'replacement', version: 1, titleKey: 'history.ext.panelHistory' },
    // Optional panels remain below the page-level tab card.
    { id: 'panels-bottom', kind: 'panel', mode: 'append', version: 1, titleKey: 'history.ext.panelsBottom' },
  ],
  locales: ['en', 'ru'],
  pages: [
    { id: 'history', titleKey: 'history.title', icon: 'history', element: 'mpu-history-page' },
  ],
};
