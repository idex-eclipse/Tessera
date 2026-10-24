import type { PluginManifest } from '../../plugin-sdk/src/types';

export const jobsManifest: PluginManifest = {
  id: '@core/jobs',
  name: 'Jobs',
  version: '2.0.0',
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
    // Ctrl+F вместо поиска браузера → поиск файлов; Alt+R → обновить список
    { id: 'find-job', scope: 'plugin', keys: 'Ctrl+F', handler: 'hotkeyFindJob', titleKey: 'jobs.hotkeys.find' },
    { id: 'refresh-jobs', scope: 'plugin', keys: 'Alt+R', handler: 'hotkeyRefreshJobs', titleKey: 'jobs.hotkeys.refresh' },
  ],

  locales: ['en', 'ru'],
  defaultSettings: {},
};