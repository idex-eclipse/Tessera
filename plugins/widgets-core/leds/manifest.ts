import type { WidgetContribution } from '../../../plugin-sdk/src/types';
import type { ChipContribution } from '../../../plugin-sdk/src/types';

export const ledsWidgets: WidgetContribution[] = [
  {
    type: 'leds',
    provider: '@core/widgets',
    titleKey: 'widgets.leds.title',
    element: 'mpu-widgets-leds',
    headerElement: 'mpu-widgets-leds-header',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 2 },
  },
];

export const ledsChips: ChipContribution[] = [
  {
    type: 'led',
    provider: '@core/widgets',
    titleKey: 'widgets.leds.chipSection',
    element: 'mpu-core-widgets-chip-led',
    pickerElement: 'mpu-core-widgets-chip-led-picker',
    icon: 'kind-led',
  },
];
