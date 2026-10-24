import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import JobsPage from './components/pages/JobsPage.svelte';
import JobsWidget from './components/widgets/JobsWidget.svelte';
import JobsWidgetHeaderActions from './components/widgets/JobsWidgetHeaderActions.svelte';

import fileIcon from './icons/file.svg?raw';

export const pageIcons: Record<string, string> = {
  file: fileIcon,
};

export { guardNo3mfPrint } from './guards.ts';
export { hotkeyFindJob, hotkeyRefreshJobs, hotkeyOpenJobs } from './hotkeys.ts';

defineMpuElement('mpu-jobs-page', JobsPage);
defineMpuElement('mpu-jobs-widget', JobsWidget);
defineMpuElement('mpu-jobs-widget-header', JobsWidgetHeaderActions);