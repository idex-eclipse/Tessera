import type { WidgetContribution, ExtensionPointDecl } from '../../../plugin-sdk/src/types';

export const limitsWidgets: WidgetContribution[] = [
  {
    type: 'limits',
    provider: '@core/widgets',
    titleKey: 'widgets.limits.title',
    element: 'mpu-widgets-limits',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 3 },
  },
];

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const limitsPoints: ExtensionPointDecl[] = [
  // the whole widget body (this widget has no header)
  { id: 'widget-limits', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetLimits' },
];
