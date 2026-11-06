import type { WidgetContribution, ExtensionPointDecl } from '../../../plugin-sdk/src/types';
import type { ChipContribution } from '../../../plugin-sdk/src/types';

export const outputsWidgets: WidgetContribution[] = [
  {
    type: 'outputs',
    provider: '@core/widgets',
    titleKey: 'widgets.outputs.title',
    element: 'mpu-widgets-outputs',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
  },
];

export const outputsChips: ChipContribution[] = [
  {
    type: 'output',
    provider: '@core/widgets',
    titleKey: 'widgets.outputs.chipSection',
    element: 'mpu-core-widgets-chip-output',
    pickerElement: 'mpu-core-widgets-chip-output-picker',
    icon: 'kind-fan',
  },
];

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const outputsPoints: ExtensionPointDecl[] = [
  // the whole widget body (this widget has no header)
  { id: 'widget-outputs', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetOutputs' },
];
