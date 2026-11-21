import type { WidgetContribution, ExtensionPointDecl, PrinterPanelContribution } from '../../../plugin-sdk/src/types';

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

/** Compact fleet launcher opens the same queue view against a fixed printer. */
export const jobQueueFleet: PrinterPanelContribution[] = [
  {
    id: 'fleet-job-queue',
    element: 'mpu-core-widgets-fleet-job-queue',
    titleKey: 'widgets.jobQueue.title',
    defaultSize: { w: 6, h: 1 },
  },
];

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const jobQueuePoints: ExtensionPointDecl[] = [
  // the whole widget body (this widget has no header)
  { id: 'widget-job-queue', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetJobQueue' },
];
