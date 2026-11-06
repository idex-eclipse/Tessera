import type { PrinterPanelContribution, WidgetContribution, ExtensionPointDecl } from '../../../plugin-sdk/src/types';

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

export const cameraFleet: PrinterPanelContribution[] = [
  {
    id: 'fleet-camera',
    element: 'mpu-core-widgets-fleet-camera',
    titleKey: 'fleet.camera.title',
  },
];

/** Extension points of this feature (all version 1), collected in the plugin manifest. */
export const cameraPoints: ExtensionPointDecl[] = [
  // the whole widget body; its header is a separate element (header-camera)
  { id: 'widget-camera', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.widgetCamera' },
  // the header bar; replace it together with the body
  { id: 'header-camera', kind: 'element', mode: 'replacement', version: 1, titleKey: 'widgets.ext.headerCamera' },
  // the stream only: 'alternative', so the original player stays one choice away (a custom WebRTC/HLS player is the typical contribution)
  { id: 'camera-stream', kind: 'element', mode: 'alternative', version: 1, titleKey: 'widgets.ext.cameraStream' },
];
