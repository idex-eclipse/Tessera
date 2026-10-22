import type { PluginManifest } from '../../plugin-sdk/src/types';

import { temperatureWidgets, temperatureChips, temperatureFleet } from './temperature/manifest';
import { macrosChips, macrosWidgets } from './macros/manifest';
import { toolsChips, toolsFleet, toolsWidgets } from './tools/manifest';
import { limitsWidgets } from './limits/manifest';
import { outputsChips, outputsWidgets } from './outputs/manifest';
import { cameraFleet, cameraWidgets } from './camera/manifest';
import { filamentChips, filamentWidgets } from './filament-sensors/manifest';
import { jobQueueWidgets } from './job-queue/manifest';

export const widgetsCoreManifest: PluginManifest = {
  id: '@core/widgets',
  name: 'Core Widgets',
  version: '1.0.1',
  entry: '/plugins/widgets-core/index.js',
  pages: [],
  widgets: [...temperatureWidgets, ...macrosWidgets, 
    ...toolsWidgets, ...limitsWidgets, ...outputsWidgets, ...cameraWidgets, 
    ...filamentWidgets, ...jobQueueWidgets],
  chips: [...temperatureChips, ...macrosChips, ...outputsChips, ...toolsChips,
    ...filamentChips], 
  printerPanels: [...cameraFleet, ...toolsFleet, ...temperatureFleet],
  locales: ['en', 'ru'],
  defaultSettings: {},
};