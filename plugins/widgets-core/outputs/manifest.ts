import type { WidgetContribution } from '../../../plugin-sdk/src/types';
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