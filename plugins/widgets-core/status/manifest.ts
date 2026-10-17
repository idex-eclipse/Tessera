import type {
  BannerContribution,
  WidgetContribution,
  PrinterPanelContribution
} from '../../../plugin-sdk/src/types';

export const statusWidgets: WidgetContribution[] = [
  {
    type: 'status',
    provider: '@core/widgets',
    titleKey: 'widgets.status.title',
    element: 'mpu-widgets-status',
    headerElement: 'mpu-widgets-status-header',
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
  },
];

export const statusBanners: BannerContribution[] = [
  {
    id: 'status',
    element: 'mpu-widgets-status-banner',
    scope: 'all',
  },
];

export const statusFleet: PrinterPanelContribution[] = [
  {
    id: 'fleet-status',
    element: 'mpu-core-widgets-fleet-status',
    titleKey: 'widgets.fleetStatus.title',
  },
]