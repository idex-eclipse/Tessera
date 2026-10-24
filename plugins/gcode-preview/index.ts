import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

import GCodePreviewPage from './GCodePreviewPage.svelte';
import GCodePreviewWidget from './GCodePreviewWidget.svelte';
import GcodePreviewHeaderActions from './GCodePreviewHeaderActions.svelte';

import cubeIcon from './icons/cube.svg?raw';

export const pageIcons: Record<string, string> = {
  cube: cubeIcon,
};

export {
  hotkeyOpenPreview,
  hotkeyLayerUp,
  hotkeyLayerDown,
  hotkeyLayerUp10,
  hotkeyLayerDown10,
  hotkeyLayerFirst,
  hotkeyLayerLast,
  hotkeyToggleTravel,
  hotkeyToggleBounds,
  hotkeyToggleMode,
  hotkeyToggleFollow,
  hotkeyToggleColor,
  hotkeyClearPreview,
  hotkeyReloadPreview,
} from './hotkeys.ts';

defineMpuElement('mpu-gcode-preview-page', GCodePreviewPage);
defineMpuElement('mpu-gcode-preview-widget', GCodePreviewWidget);
defineMpuElement('mpu-gcode-preview-header', GcodePreviewHeaderActions);