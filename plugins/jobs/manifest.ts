import type { PluginManifest } from '../../plugin-sdk/src/types';

export const jobsManifest: PluginManifest = {
  id: '@core/jobs',
  name: 'Jobs',
  version: '1.0.0',
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
  locales: ['en', 'ru'],
  defaultSettings: {},
};