import type { PrinterPanelContribution, WidgetContribution } from '../../../plugin-sdk/src/types';
import type { ChipContribution } from '../../../plugin-sdk/src/types';

export const toolsWidgets: WidgetContribution[] = [
  {
    type: 'tools',
    provider: '@core/widgets',
    titleKey: 'widgets.tools.title',
    element: 'mpu-widgets-tools',
    headerElement: 'mpu-widgets-tools-header',
    defaultSize: { w: 4, h: 8 },
    minSize: { w: 3, h: 6 },
  },
];

export const toolsChips: ChipContribution[] = [
  {
    type: 'tuning',
    provider: '@core/widgets',
    titleKey: 'widgets.tools.tuning.chipSection',
    element: 'mpu-core-widgets-chip-tuning',
    pickerElement: 'mpu-core-widgets-chip-tuning-picker',
    icon: 'kind-tuning',
  },
];

export const toolsFleet: PrinterPanelContribution[] = [
  {
    id: 'fleet-position',
    element: 'mpu-core-widgets-fleet-position',
    titleKey: 'widgets.fleetPosition.title',
  },
]