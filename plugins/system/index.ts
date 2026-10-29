import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

import SystemPage from './components/pages/SystemPage.svelte';
import SystemRightPanel from './components/right-panel/SystemRightPanel.svelte';
import StateBanner from './components/banners/SystemBanner.svelte';
import SystemNotificationsOverlay from './components/overlays/SystemNotificationsOverlay.svelte';
import PowerChip from './components/chips/PowerChip.svelte';
import PowerChipPicker from './components/chips/PowerChipPicker.svelte';

import serverIcon from './icons/server.svg?raw';

export const pageIcons: Record<string, string> = {
  server: serverIcon,
};

export { guardSystemPrintSafety } from './guards.ts';
export {
  hotkeyToggleNotifications,
  hotkeyOpenMachine,
  hotkeyRefreshMachine,
  hotkeyUploadFile,
  hotkeyTogglePrintAfter,
  hotkeyTabOverview,
  hotkeyTabMonitoring,
  hotkeyTabMaintenance,
} from './hotkeys.ts';

defineMpuElement('mpu-system-page', SystemPage);
defineMpuElement('mpu-system-right-panel', SystemRightPanel);
defineMpuElement('mpu-system-state-banner', StateBanner);
defineMpuElement('mpu-system-notifications', SystemNotificationsOverlay);
defineMpuElement('mpu-core-system-chip-power', PowerChip);
defineMpuElement('mpu-core-system-chip-power-picker', PowerChipPicker);

import StatusWidget from './components/widgets/StatusWidget.svelte';
import StatusHeader from './components/widgets/StatusHeader.svelte';
defineMpuElement('mpu-widgets-status', StatusWidget);
defineMpuElement('mpu-widgets-status-header', StatusHeader);

import StatusPanel from './components/fleet/StatusPanel.svelte';
defineMpuElement('mpu-system-fleet-status', StatusPanel);