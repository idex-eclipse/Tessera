import type { WidgetContribution, ExtensionPointDecl, ExtensionContribution } from '../../../plugin-sdk/src/types';
import type { ChipContribution } from '../../../plugin-sdk/src/types';

export const filamentWidgets: WidgetContribution[] = [
  {
    type: 'filament',
    provider: '@core/widgets',
    titleKey: 'widgets.filament.title',
    element: 'mpu-widgets-filament',
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
  },
];

export const filamentChips: ChipContribution[] = [
  {
    type: 'filament',
    provider: '@core/widgets',
    titleKey: 'widgets.filament.chipSection',
    element: 'mpu-core-widgets-chip-filament',
    pickerElement: 'mpu-core-widgets-chip-filament-picker',
    icon: 'kind-filament',
  },
];

/** Adds read-only filament details and a critical summary to System's Fleet Health. */
export const filamentHealthExtensions: ExtensionContribution[] = [
  {
    point: '@core/system#fleet-health-sections',
    kind: 'element',
    version: 1,
    id: 'filament-health',
    titleKey: 'widgets.filament.title',
    element: 'mpu-core-widgets-fleet-filament-health',
  },
];

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const filamentPoints: ExtensionPointDecl[] = [
  // the whole widget body (this widget has no header)
  { id: 'widget-filament', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetFilament' },
];
