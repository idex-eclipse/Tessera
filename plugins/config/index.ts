import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import ConfigPage from './ConfigPage.svelte';

import codeIcon from './icons/code.svg?raw';

export const pageIcons: Record<string, string> = {
  code: codeIcon,
};

defineMpuElement('mpu-config-page', ConfigPage);