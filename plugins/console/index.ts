import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

import ConsolePage from './components/pages/ConsolePage.svelte';
import ConsoleWidget from './components/widgets/ConsoleWidget.svelte';
import ConsoleHeaderActions from './components/widgets/ConsoleHeaderActions.svelte';

import terminalIcon from './icons/terminal.svg?raw';

export const pageIcons: Record<string, string> = {
  terminal: terminalIcon,
};

export {
  hotkeyOpenConsole,
  hotkeyFocusInput,
  hotkeyClear,
  hotkeyRefresh,
  hotkeyToggleAutoscroll,
  hotkeyToggleReverse,
  hotkeyToggleFilters,
} from './hotkeys.ts';

defineMpuElement('mpu-console-page', ConsolePage);
defineMpuElement('mpu-console-widget', ConsoleWidget);
defineMpuElement('mpu-console-widget-header', ConsoleHeaderActions);