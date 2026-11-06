import type { WidgetContribution, ChipContribution, PrinterPanelContribution, ExtensionPointDecl } from '../../../plugin-sdk/src/types';

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
    titleKey: 'fleet.temps.title',
  },
]

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const temperaturePoints: ExtensionPointDecl[] = [
  // the whole widget body; its header is a separate element (header-temperature)
  { id: 'widget-temperature', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetTemperature' },
  // the header bar; replace it together with the body, its buttons drive the original body
  { id: 'header-temperature', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.headerTemperature' },
  // the sensor table / cards (with the "no printer" and "not ready" notices); the chart stays
  { id: 'temperature-sensors', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.temperatureSensors' },
  // the chart only
  { id: 'temperature-chart', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.temperatureChart' },
  // extra panels under the chart
  { id: 'temperature-extra', kind: 'panel', mode: 'append', version: 1, titleKey: 'widgets.ext.temperatureExtra' },
];
