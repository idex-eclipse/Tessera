import { onDestroy } from 'svelte';

import type { PluginApi, PluginSettingsApi } from '../../../plugin-sdk/src/types';
import { watchSettings } from '../settings/watch-settings';

type SectionsState = Record<string, boolean>;

interface SavedState {
  wide: SectionsState;
  narrow: SectionsState;
}

export interface AccordionState {
  isOpen(id: string, narrow: boolean, defaultOpen: boolean): boolean;
  toggle(id: string, narrow: boolean, defaultOpen: boolean): void;
  reload(): void;
}

/**
 * Запомненные секции-аккордеоны. Обычный и мобильный режимы хранятся раздельно: свёрнутое на
 * телефоне не сворачивается на десктопе. Секция без сохранённого значения следует умолчанию режима.
 */
export function createAccordionState(
  settings: Pick<PluginSettingsApi, 'get' | 'set'>,
  key: string,
): AccordionState {
  const read = (): SavedState => {
    const saved = settings.get<Partial<SavedState>>(key);
    return { wide: saved?.wide ?? {}, narrow: saved?.narrow ?? {} };
  };

  let state = $state<SavedState>(read());

  function isOpen(id: string, narrow: boolean, defaultOpen: boolean): boolean {
    return state[narrow ? 'narrow' : 'wide'][id] ?? defaultOpen;
  }

  return {
    isOpen,
    toggle(id, narrow, defaultOpen) {
      const mode = narrow ? 'narrow' : 'wide';
      state = {
        ...state,
        [mode]: { ...state[mode], [id]: !isOpen(id, narrow, defaultOpen) },
      };
      settings.set(key, $state.snapshot(state));
    },
    reload() {
      state = read();
    },
  };
}

/**
 * Состояние хранится в настройках активного принтера и перечитывается при его смене, при
 * подгрузке настроек из Moonraker DB и при переключении sync (watchSettings; раньше было только
 * при смене принтера, и свежие настройки из DB не доходили до открытого виджета).
 */
export function useAccordionState(api: PluginApi, key: string): AccordionState {
  // The accordion follows the active surface, while each write has an explicit printer ID.
  const settings = {
    get: <T,>(settingKey: string) => api.settingsFor(api.printer.id).get<T>(settingKey),
    set: (settingKey: string, value: unknown) => api.settingsFor(api.printer.id).set(settingKey, value),
  };
  const accordion = createAccordionState(settings, key);
  onDestroy(watchSettings(api, () => accordion.reload()));
  return accordion;
}
