import type { WidgetContribution } from '../../../plugin-sdk/src/types';

export const jobQueueWidgets: WidgetContribution[] = [
  {
    type: 'job-queue',
    provider: '@core/widgets',
    titleKey: 'widgets.jobQueue.title',
    element: 'mpu-widgets-job-queue',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
  },
];