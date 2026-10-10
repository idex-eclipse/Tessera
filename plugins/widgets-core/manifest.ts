import type { PluginManifest } from '../../plugin-sdk/src/types';

import { statusBanners, statusWidgets } from './status/manifest';
import { temperatureWidgets, temperatureChips } from './temperature/manifest';
import { macrosChips, macrosWidgets } from './macros/manifest';
import { toolsChips, toolsWidgets } from './tools/manifest';
import { limitsWidgets } from './limits/manifest';
import { outputsChips, outputsWidgets } from './outputs/manifest';
import { cameraWidgets } from './camera/manifest';
import { filamentChips, filamentWidgets } from './filament-sensors/manifest';
import { jobQueueWidgets } from './job-queue/manifest';

export const widgetsCoreManifest: PluginManifest = {
  id: '@core/widgets',
  name: 'Core Widgets',
  version: '1.0.0',
  entry: '/plugins/widgets-core/index.js',
  pages: [],
  widgets: [...temperatureWidgets, ...statusWidgets, ...macrosWidgets, 
    ...toolsWidgets, ...limitsWidgets, ...outputsWidgets, ...cameraWidgets, 
    ...filamentWidgets, ...jobQueueWidgets],
  chips: [...temperatureChips, ...macrosChips, ...outputsChips, ...toolsChips,
    ...filamentChips], 
  banners: [...statusBanners],
  locales: ['en', 'ru'],
  defaultSettings: {},
};