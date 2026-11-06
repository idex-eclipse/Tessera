import type { WidgetContribution, ExtensionPointDecl } from '../../../plugin-sdk/src/types';
import type { ChipContribution } from '../../../plugin-sdk/src/types';

export const macrosWidgets: WidgetContribution[] = [
  {
    type: 'macros',
    provider: '@core/widgets',
    titleKey: 'widgets.macros.title',
    element: 'mpu-widgets-macros',
    headerElement: 'mpu-widgets-macros-header',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
  },
];

export const macrosChips: ChipContribution[] = [
  {
    type: 'macro',
    provider: '@core/widgets',
    titleKey: 'widgets.macros.chipSection',
    element: 'mpu-core-widgets-chip-macro',
    pickerElement: 'mpu-core-widgets-chip-macro-picker',
    icon: 'macro',
  },
];

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const macrosPoints: ExtensionPointDecl[] = [
  // the whole widget body; its header (edit mode, menu) is a separate element (header-macros)
  { id: 'widget-macros', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetMacros' },
  // the header bar; replace it together with the body
  { id: 'header-macros', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.headerMacros' },
];
