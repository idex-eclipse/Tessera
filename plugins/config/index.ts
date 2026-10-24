import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import ConfigPage from './ConfigPage.svelte';

import codeIcon from './icons/code.svg?raw';

export const pageIcons: Record<string, string> = {
  code: codeIcon,
};

export { guardCriticalConfig } from './guards.ts';
export { hotkeyFindFile, hotkeyTabLogs, hotkeyTabDocs, hotkeyTabExamples, hotkeyOpenConfig } from './hotkeys.ts';

defineMpuElement('mpu-config-page', ConfigPage);