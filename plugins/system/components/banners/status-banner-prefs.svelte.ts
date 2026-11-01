import { onDestroy } from 'svelte';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import type { ProgressMode } from '../../use-print-status.svelte.ts';

/** Настройки, общие для полного и свёрнутого баннера статуса. Вызывать при инициализации компонента. */
export function useStatusBannerPrefs(api: PluginApi) {
  let mode = $state(api.settings.get<ProgressMode>('status.progressMode') ?? 'file');
  let banner = $state(api.settings.get<boolean>('status.banner') ?? true);

  const off = api.settings.onChange((k, v) => {
    if (k === 'status.progressMode') mode = v as ProgressMode;
    if (k === 'status.banner') banner = Boolean(v);
  });
  onDestroy(off);

  return {
    get mode(): ProgressMode {
      return mode;
    },
    get banner(): boolean {
      return banner;
    },
  };
}
