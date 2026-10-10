import type { HostI18n } from '../core/host-i18n.svelte.ts';

import en from './locales/en';
import ru from './locales/ru';

/**
 * Core locale options for future locale selector.
 */
export const CORE_LOCALE_OPTIONS = [
  {
    code: 'en',
    nativeName: 'English',
    dir: 'ltr',
  },
  {
    code: 'ru',
    nativeName: 'Русский',
    dir: 'ltr',
  },
] as const;

/**
 * Registers built-in host locales.
 * Remote plugin locales will be registered later by plugin-loader.
 */
export function registerCoreLocales(i18n: HostI18n): void {
  i18n.addMessages('en', en);
  i18n.addMessages('ru', ru);
}