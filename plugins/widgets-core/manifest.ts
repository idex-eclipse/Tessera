import type { PluginManifest } from '../../plugin-sdk/src/types';

import { temperatureWidgets, temperatureChips, temperatureFleet, temperaturePoints } from './temperature/manifest';
import { macrosChips, macrosWidgets, macrosPoints } from './macros/manifest';
import { toolsChips, toolsFleet, toolsPoints, toolsWidgets } from './tools/manifest';
import { limitsPoints, limitsWidgets } from './limits/manifest';
import { outputsChips, outputsPoints, outputsWidgets } from './outputs/manifest';
import { ledsChips, ledsPoints, ledsWidgets } from './leds/manifest';
import { cameraFleet, cameraPoints, cameraWidgets } from './camera/manifest';
import { filamentChips, filamentPoints, filamentWidgets } from './filament-sensors/manifest';
import { jobQueuePoints, jobQueueWidgets } from './job-queue/manifest';
import { sliderPoints } from '../shared/slider-field/extension-points';

export const widgetsCoreManifest: PluginManifest = {
  id: '@core/widgets',
  name: 'Core Widgets',
  version: '3.0.0',
  entry: '/plugins/widgets-core/index.js',
  pages: [],
  widgets: [...temperatureWidgets, ...macrosWidgets, 
    ...toolsWidgets, ...limitsWidgets, ...outputsWidgets, ...ledsWidgets, ...cameraWidgets, 
    ...filamentWidgets, ...jobQueueWidgets],
  chips: [...temperatureChips, ...macrosChips, ...outputsChips, ...ledsChips, ...toolsChips,
    ...filamentChips], 
  printerPanels: [...cameraFleet, ...toolsFleet, ...temperatureFleet],
  // Extensions replace whole widgets and their headers, large parts of Temperature / Tools / Camera, and
  // add panels to Temperature and Tools. All points are version 1; ids are unique across the plugin, so
  // they are prefixed by widget. The slider point belongs to the shared SliderField used by Tools, Outputs,
  // Limits, LEDs and the Outputs / Tuning chips.
  // Not extensible on purpose: chips as a whole, fleet panels (they get the printer id from the host and the
  // plugin settings are still bound to the active printer), Macros groups and per-LED controls.
  // Note for extension authors: a widget header drives the original body, so replace both (docs/surfaces.md).
  extensionPoints: [
    ...temperaturePoints, ...toolsPoints, ...cameraPoints, ...macrosPoints, ...ledsPoints,
    ...outputsPoints, ...limitsPoints, ...filamentPoints, ...jobQueuePoints,
    ...sliderPoints('widgets'),
  ],
  locales: ['en', 'ru'],
  defaultSettings: {},
};