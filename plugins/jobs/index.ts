import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import JobsPage from './JobsPage.svelte';
import JobsWidget from './JobsWidget.svelte';
import JobsWidgetHeaderActions from './JobsWidgetHeaderActions.svelte';

import fileIcon from './icons/file.svg?raw';

export const pageIcons: Record<string, string> = {
  file: fileIcon,
};

defineMpuElement('mpu-jobs-page', JobsPage);
defineMpuElement('mpu-jobs-widget', JobsWidget);
defineMpuElement('mpu-jobs-widget-header', JobsWidgetHeaderActions);