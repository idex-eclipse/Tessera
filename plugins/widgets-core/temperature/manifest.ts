import type { WidgetContribution, ChipContribution, PrinterPanelContribution} from '../../../plugin-sdk/src/types';

export const temperatureWidgets: WidgetContribution[] = [
  {
    type: 'temperature-graph',
    provider: '@core/widgets',
    titleKey: 'widgets.temperature.title',
    element: 'mpu-widgets-temperature-graph',
    headerElement: 'mpu-widgets-temperature-header',
    defaultSize: { w: 6, h: 8 },
    minSize: { w: 6, h: 8 },
  },
];

export const temperatureChips: ChipContribution[] = [
  {
    type: 'temperature',
    provider: '@core/widgets',
    titleKey: 'widgets.temperature.title',
    element: 'mpu-core-widgets-chip-temperature',
    pickerElement: 'mpu-core-widgets-chip-temperature-picker',
  },
];

export const temperatureFleet: PrinterPanelContribution[] = [
  {
    id: 'fleet-temps',
    element: 'mpu-core-widgets-fleet-temps',
    titleKey: 'widgets.fleetTemps.title',
  },
]