import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import ConfigPage from './components/page/ConfigPage.svelte';
import ConfigRestartNotifications from './components/overlays/ConfigRestartNotifications.svelte';
import ConfigRestartRestoreAction from './components/overlays/ConfigRestartRestoreAction.svelte';
import ConfigEditorOverlay from './components/overlays/ConfigEditorOverlay.svelte';
import ConfigEditorBanner from './components/banners/ConfigEditorBanner.svelte';
import ConfigEditorBannerCollapsed from './components/banners/ConfigEditorBannerCollapsed.svelte';
import NotificationPageAction from '../shared/notification-actions/NotificationPageAction.svelte';

import codeIcon from './icons/code.svg?raw';

export const pageIcons: Record<string, string> = {
  code: codeIcon,
};

export { guardCriticalConfig } from './guards.ts';
export { hotkeyFindFile, hotkeyTabLogs, hotkeyTabDocs, hotkeyTabExamples, hotkeyOpenConfig,
  hotkeyEditorReplace, hotkeyEditorSave, hotkeyEditorHelp, hotkeyEditorClose,
  hotkeyEditorPeek, hotkeyEditorOpenMacro } from './hotkeys.ts';

defineMpuElement('mpu-config-page', ConfigPage);
defineMpuElement('mpu-config-restart-notifications', ConfigRestartNotifications);
defineMpuElement('mpu-config-editor-overlay', ConfigEditorOverlay);
defineMpuElement('mpu-config-editor-banner', ConfigEditorBanner);
defineMpuElement('mpu-config-editor-banner-collapsed', ConfigEditorBannerCollapsed);
defineMpuElement('mpu-config-notification-page-action', NotificationPageAction);
defineMpuElement('mpu-config-restart-restore-action', ConfigRestartRestoreAction);
