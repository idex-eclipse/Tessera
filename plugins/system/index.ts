import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

import SystemPage from './components/pages/SystemPage.svelte';
import SystemRightPanel from './components/right-panel/SystemRightPanel.svelte';
import KlipperStateBanner from './components/banners/KlipperStateBanner.svelte';
import SystemNotificationsOverlay from './components/overlays/SystemNotificationsOverlay.svelte';
import PowerChip from './components/chips/PowerChip.svelte';
import PowerChipPicker from './components/chips/PowerChipPicker.svelte';

import serverIcon from './icons/server.svg?raw';

export const pageIcons: Record<string, string> = {
  server: serverIcon,
};

defineMpuElement('mpu-system-page', SystemPage);
defineMpuElement('mpu-system-right-panel', SystemRightPanel);
defineMpuElement('mpu-klipper-state-banner', KlipperStateBanner);
defineMpuElement('mpu-system-notifications', SystemNotificationsOverlay);
defineMpuElement('mpu-core-system-chip-power', PowerChip);
defineMpuElement('mpu-core-system-chip-power-picker', PowerChipPicker);