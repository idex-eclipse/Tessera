import type { WidgetContribution } from '../../../plugin-sdk/src/types';

export const cameraWidgets: WidgetContribution[] = [
  {
    type: 'camera',
    provider: '@core/widgets',
    titleKey: 'widgets.camera.title',
    element: 'mpu-widgets-camera',
    headerElement: 'mpu-widgets-camera-header',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
  },
];