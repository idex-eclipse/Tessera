import type { PluginManifest } from '../../plugin-sdk/src/types';
import { fileTablePoints } from '../shared/file-table/extension-points';

export const jobsManifest: PluginManifest = {
  id: '@core/jobs',
  name: 'Jobs',
  version: '4.0.0',
  entry: '/plugins/jobs/index.js',
  pages: [
    { 
      id: 'jobs', 
      titleKey: 'jobs.title', 
      icon: 'file', 
      element: 'mpu-jobs-page' 
    }
  ],
  widgets: [
    {
      type: 'jobs-table',
      provider: '@core/jobs',
      titleKey: 'jobs.title',
      icon: 'file',
      element: 'mpu-jobs-widget', headerElement: 'mpu-jobs-widget-header',
      defaultSize: { w: 6, h: 4 },
      minSize: { w: 4, h: 2 },
    },
  ],
  guards: [
    {
      id: 'jobs-no-3mf-print',
      match: ['printer.print.start', 'server.job_queue.post_job'],
      handler: 'guardNo3mfPrint',
    },
  ],

  hotkeys: [
    // открыть страницу плагина с любой страницы
    { id: 'open-jobs', scope: 'global', keys: 'J', handler: 'hotkeyOpenJobs', titleKey: 'jobs.hotkeys.open' },
    // Ctrl+F вместо поиска браузера → поиск файлов; Alt+R → обновить список
    { id: 'find-job', scope: 'plugin', keys: 'Ctrl+F', handler: 'hotkeyFindJob', titleKey: 'jobs.hotkeys.find' },
    { id: 'refresh-jobs', scope: 'plugin', keys: 'Alt+R', handler: 'hotkeyRefreshJobs', titleKey: 'jobs.hotkeys.refresh' },
  ],

  // Extensions embed into the dashboard widget and the page. All points are version 1.
  // The widget and the page both embed the shared FileTable, so they share its three points.
  // Not extensible: the 3MF inspector overlay and its upload/print flow stay outside `page`, so a
  // `?inspect=` deep link keeps working even when the page content is replaced.
  // Note for extension authors: the table carries "Print" in its file menu, so replacing the
  // widget body, the page or the table also replaces that way to start a print (docs/surfaces.md).
  extensionPoints: [
    // the whole widget body (its header with the toolbar stays)
    { id: 'widget-table', kind: 'element', mode: 'replacement', version: 1, titleKey: 'jobs.ext.widgetTable' },
    // the whole page content (the table panel and the bottom panels)
    { id: 'page', kind: 'element', mode: 'replacement', version: 1, titleKey: 'jobs.ext.page' },
    // 'element', not 'panel': the table draws its own card, a host panel shell would double the chrome
    { id: 'panel-table', kind: 'element', mode: 'replacement', version: 1, titleKey: 'jobs.ext.panelTable' },
    // extra panels at the very bottom of the page
    { id: 'panels-bottom', kind: 'panel', mode: 'append', version: 1, titleKey: 'jobs.ext.panelsBottom' },
    // file-actions, file-editor, file-viewer: the points of the shared FileTable
    ...fileTablePoints('jobs'),
  ],

  locales: ['en', 'ru'],
  defaultSettings: {},
};