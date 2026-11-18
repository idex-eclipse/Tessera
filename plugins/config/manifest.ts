import type { PluginManifest } from '../../plugin-sdk/src/types';
import { fileTablePoints } from '../shared/file-table/extension-points';

export const configManifest: PluginManifest = {
  id: '@core/config',
  name: 'Config',
  version: '4.2.0',
  entry: '/plugins/config/index.js',
  pages: [
    { id: 'config', titleKey: 'config.title', icon: 'code', element: 'mpu-config-page' },
  ],
  overlays: [
    // Monitoring must survive page changes and reloads made while another page is active.
    { id: 'restart-notifications', element: 'mpu-config-restart-notifications' },
    // The editor owns buffers independently of either file table's page lifecycle.
    { id: 'editor', element: 'mpu-config-editor-overlay' },
  ],
  banners: [
    { id: 'editor', element: 'mpu-config-editor-banner' },
  ],
  collapsedBanners: [
    { id: 'editor-collapsed', banner: 'editor', element: 'mpu-config-editor-banner-collapsed' },
  ],
  guards: [
    {
      id: 'config-critical-files',
      match: [
        'server.files.delete_file',
        'server.files.delete_directory',
        'server.files.move',
        'server.files.copy',
      ],
      handler: 'guardCriticalConfig',
    },
  ],

  hotkeys: [
    // открыть страницу плагина с любой страницы
    { id: 'open-config', scope: 'global', keys: 'Shift+C', handler: 'hotkeyOpenConfig', titleKey: 'config.hotkeys.open' },
    // Ctrl+F вместо поиска браузера → поиск файлов; Alt+L/D/C → вкладки правой таблицы
    { id: 'find-file', scope: 'plugin', when: 'page-or-editor', keys: 'Ctrl+F', allowInInputs: true, handler: 'hotkeyFindFile', titleKey: 'config.hotkeys.find' },
    // Editor-only bindings are checked before preventDefault so browser shortcuts still work with the modal closed.
    { id: 'editor-replace', scope: 'plugin', when: 'editor', keys: 'Mod+H', allowInInputs: true, handler: 'hotkeyEditorReplace', titleKey: 'config.hotkeys.editorReplace' },
    { id: 'editor-save', scope: 'plugin', when: 'editor', keys: 'Mod+S', allowInInputs: true, handler: 'hotkeyEditorSave', titleKey: 'config.hotkeys.editorSave' },
    { id: 'editor-help', scope: 'plugin', when: 'editor', keys: 'F1', allowInInputs: true, handler: 'hotkeyEditorHelp', titleKey: 'config.hotkeys.editorHelp' },
    { id: 'editor-close', scope: 'plugin', when: 'editor', keys: 'Escape', allowInInputs: true, handler: 'hotkeyEditorClose', titleKey: 'config.hotkeys.editorClose' },
    { id: 'editor-peek', scope: 'plugin', when: 'editor', keys: 'Mod+P', allowInInputs: true, handler: 'hotkeyEditorPeek', titleKey: 'config.hotkeys.editorPeek' },
    { id: 'editor-open-macro', scope: 'plugin', when: 'editor', keys: 'Mod+O', allowInInputs: true, handler: 'hotkeyEditorOpenMacro', titleKey: 'config.hotkeys.editorOpenMacro' },
    { id: 'tab-logs', scope: 'plugin', keys: 'Alt+L', handler: 'hotkeyTabLogs', titleKey: 'config.hotkeys.tabLogs' },
    { id: 'tab-docs', scope: 'plugin', keys: 'Alt+D', handler: 'hotkeyTabDocs', titleKey: 'config.hotkeys.tabDocs' },
    { id: 'tab-examples', scope: 'plugin', keys: 'Alt+C', handler: 'hotkeyTabExamples', titleKey: 'config.hotkeys.tabExamples' },
  ],

  // Extensions embed into the page, its two file tables and a bottom panel area. All points are version 1.
  // Deliberately NOT extensible: the tabs of the right table (they map to fixed Moonraker roots),
  // the rename/delete dialogs, and the critical-file guard above (guards are not inherited).
  extensionPoints: [
    // Config retains file writes and undo; the builder receives only a bounded buffer edit.
    { id: 'macro-builder', kind: 'action', mode: 'append', max: 1, version: 1, titleKey: 'config.ext.macroBuilder' },
    // the whole page content (both tables and the bottom panels)
    { id: 'page', kind: 'element', mode: 'replacement', version: 1, titleKey: 'config.ext.page' },
    // each table as a whole; the right one includes its tab strip
    { id: 'table-config', kind: 'element', mode: 'replacement', version: 1, titleKey: 'config.ext.tableConfig' },
    { id: 'table-other', kind: 'element', mode: 'replacement', version: 1, titleKey: 'config.ext.tableOther' },
    // extra panels at the very bottom of the page
    { id: 'panels-bottom', kind: 'panel', mode: 'append', version: 1, titleKey: 'config.ext.panelsBottom' },
    // file-actions, file-editor, file-viewer: the points of the shared FileTable
    ...fileTablePoints('config'),
  ],

  locales: ['en', 'ru'],
  defaultSettings: {},
};
