import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import HistoryPage from './HistoryPage.svelte';

import historyIcon from './icons/history.svg?raw';

export const pageIcons: Record<string, string> = {
  history: historyIcon,
};

defineMpuElement('mpu-history-page', HistoryPage);