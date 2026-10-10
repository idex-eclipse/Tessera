import type { WidgetContribution } from '../../../plugin-sdk/src/types';

export const limitsWidgets: WidgetContribution[] = [
  {
    type: 'limits',
    provider: '@core/widgets',
    titleKey: 'widgets.limits.title',
    element: 'mpu-widgets-limits',
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 3 },
  },
];