import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import HistoryPage from './components/page/HistoryPage.svelte';
import HistoryFleetPanel from './components/fleet/HistoryFleetPanel.svelte';

import historyIcon from './icons/history.svg?raw';

export const pageIcons: Record<string, string> = {
  history: historyIcon,
};

export { guardHistoryOwnerOnly } from './guards.ts';
export {
  hotkeyFindHistory,
  hotkeyRefreshHistory,
  hotkeyOpenHistory,
  hotkeyTabHistory,
  hotkeyTabStatistics,
  hotkeyTabLeft,
  hotkeyTabRight,
} from './hotkeys.ts';

defineMpuElement('mpu-history-page', HistoryPage);
defineMpuElement('mpu-history-fleet', HistoryFleetPanel);
