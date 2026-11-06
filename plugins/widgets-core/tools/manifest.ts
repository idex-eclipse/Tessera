import type { PrinterPanelContribution, WidgetContribution, ExtensionPointDecl } from '../../../plugin-sdk/src/types';
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
    titleKey: 'fleet.position.title',
  },
]

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const toolsPoints: ExtensionPointDecl[] = [
  // the whole widget body; its header is a separate element (header-tools)
  { id: 'widget-tools', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetTools' },
  // the header bar; replace it together with the body
  { id: 'header-tools', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.headerTools' },
  // tool chips, dual carriage, step, jog pad or axis rows, home and position
  { id: 'tools-move', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.toolsMove' },
  // bodies of the accordion sections: the section header and its open state stay
  { id: 'tools-extrude', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.toolsExtrude' },
  { id: 'tools-speed-flow', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.toolsSpeedFlow' },
  { id: 'tools-pa', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.toolsPa' },
  { id: 'tools-retraction', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.toolsRetraction' },
  // extra accordion sections after the built-in ones
  { id: 'tools-sections', kind: 'panel', mode: 'append', version: 1, titleKey: 'widgets.ext.toolsSections' },
];
