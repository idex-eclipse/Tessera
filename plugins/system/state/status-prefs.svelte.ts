import type { PluginApi } from '../../../plugin-sdk/src/types';
import { useSetting } from '../../shared/settings/create-setting.svelte';
import { asBoolean, oneOf } from '../../shared/settings/parsers';
import {
  DEFAULT_FIELDS,
  parseEnabledFields,
  type ProgressMode,
  type StatusFieldId,
} from '../lib/status-fields';

const PROGRESS_MODES: readonly ProgressMode[] = ['file', 'time', 'filament'];

/**
 * Settings shared by every surface of the print status (widget, its header menu, full and
 * collapsed banner). Each value is a reactive setting, so every surface follows the others and
 * the Moonraker DB / printer switches without per-component `onChange` plumbing. Call during
 * component initialisation (it registers `onDestroy` through `useSetting`).
 */
export function useStatusPrefs(api: PluginApi) {
  const mode = useSetting<ProgressMode>(api, 'status.progressMode', 'file', oneOf(PROGRESS_MODES));
  const banner = useSetting(api, 'status.banner', true, asBoolean);
  const bannerFieldsOpen = useSetting(api, 'status.bannerFieldsOpen', true, asBoolean);
  const fields = useSetting<StatusFieldId[]>(api, 'status.fields', [...DEFAULT_FIELDS], (raw) =>
    parseEnabledFields(raw),
  );

  return {
    get mode(): ProgressMode {
      return mode.value;
    },
    get banner(): boolean {
      return banner.value;
    },
    get bannerFieldsOpen(): boolean {
      return bannerFieldsOpen.value;
    },
    /** Enabled stat fields, always in the canonical order of `DEFAULT_FIELDS`. */
    get fields(): StatusFieldId[] {
      return fields.value;
    },
    setMode: (v: ProgressMode) => mode.set(v),
    setBanner: (v: boolean) => banner.set(v),
    setBannerFieldsOpen: (v: boolean) => bannerFieldsOpen.set(v),
    setFields: (v: StatusFieldId[]) => fields.set(v),
  };
}
