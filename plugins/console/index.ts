import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

import ConsolePage from './ConsolePage.svelte';
import ConsoleWidget from './ConsoleWidget.svelte';
import ConsoleHeaderActions from './ConsoleHeaderActions.svelte';

import terminalIcon from './icons/terminal.svg?raw';

export const pageIcons: Record<string, string> = {
  terminal: terminalIcon,
};

defineMpuElement('mpu-console-page', ConsolePage);
defineMpuElement('mpu-console-widget', ConsoleWidget);
defineMpuElement('mpu-console-widget-header', ConsoleHeaderActions);