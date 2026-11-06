import type { WidgetContribution, ExtensionPointDecl } from '../../../plugin-sdk/src/types';

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

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const jobQueuePoints: ExtensionPointDecl[] = [
  // the whole widget body (this widget has no header)
  { id: 'widget-job-queue', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetJobQueue' },
];
