import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

import CalibrationsPage from './components/CalibrationsPage.svelte';
import CalibrationsWidget from './components/widgets/CalibrationsWidget.svelte';
import BedMeshWidget from './components/widgets/BedMesh/BedMeshWidget.svelte';
import BedMeshWidgetHeader from './components/widgets/BedMesh/BedMeshWidgetHeader.svelte';
import TestZOverlay from './components/overlays/TestZOverlay.svelte';
import ScrewsTiltOverlay from './components/overlays/ScrewsTiltOverlay.svelte';
import slidersIcon from './icons/sliders.svg?raw';
import LiveZChip from './components/chips/LiveZChip.svelte';
import LiveZChipPicker from './components/chips/LiveZChipPicker.svelte';

export { guardCalibScript, guardCalibPrintStart } from './guards.ts';
export {
  hotkeyTabMesh, hotkeyTabProbe, hotkeyTabHeaters, hotkeyTabShaper,
  hotkeyTestzUp, hotkeyTestzDown, hotkeyTestzUpFine, hotkeyTestzDownFine,
  hotkeyProbeAccept, hotkeyProbeAbort,
  hotkeyOpenCalibrations,
} from './hotkeys.ts';

export const pageIcons: Record<string, string> = {
  sliders: slidersIcon,
};

defineMpuElement('mpu-calibrations-page', CalibrationsPage);
defineMpuElement('mpu-calibrations-widget', CalibrationsWidget);
defineMpuElement('mpu-bed-mesh-widget', BedMeshWidget);
defineMpuElement('mpu-bed-mesh-widget-header', BedMeshWidgetHeader);
defineMpuElement('mpu-test-z-overlay', TestZOverlay);
defineMpuElement('mpu-screws-tilt-overlay', ScrewsTiltOverlay);
defineMpuElement('mpu-core-calibrations-chip-livez', LiveZChip);
defineMpuElement('mpu-core-calibrations-chip-livez-picker', LiveZChipPicker);