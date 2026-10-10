import type { LocaleDirection } from '../../../plugin-sdk/src/types';

import type { UiStore } from './ui-store.svelte.ts';

/**
 * Modular Printer UI v2
 * Host i18n.
 *
 * Source of truth: CONTEXT.md
 *
 * Responsibilities:
 * - translate host UI keys
 * - fallback locale
 * - locale variants (ru-RU -> ru)
 * - nested and flat keys
 * - interpolation
 * - message registration for core and future plugins
 * - locale change notifications
 *
 * Non-responsibilities:
 * - Moonraker
 * - business data
 * - plugin-to-plugin communication
 */

export type I18nMessages = Record<string, unknown>;

export interface I18nAddMessagesOptions {
  /**
   * Optional namespace prefix.
   * Useful for plugins:
   * addMessages('en', dict, { prefix: manifest.id })
   */
  prefix?: string;
}

export interface HostI18nOptions {
  fallbackLocale?: string;
  messages?: Record<string, I18nMessages>;
}

export type HostI18n = ReturnType<typeof createHostI18n>;

export function createHostI18n(
  ui: UiStore,
  options: HostI18nOptions = {},
) {
  const fallbackLocale = normalizeLocale(options.fallbackLocale ?? 'en');

  let messages = $state<Record<string, I18nMessages>>(
    normalizeMessageCatalog(options.messages ?? {}),
  );

  let lastNotified = {
    locale: ui.locale,
    dir: ui.dir,
  };

  const localeChangeListeners = new Set<
    (locale: string, dir: LocaleDirection) => void
  >();

  // ------------------------------------------------------------------
  // Translation
  // ------------------------------------------------------------------

  function t(
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const candidates = getLocaleCandidates(ui.locale, fallbackLocale);

    for (const candidate of candidates) {
      const dictionary = messages[candidate];
      const template = resolveMessage(dictionary, key);

      if (template !== undefined) {
        return interpolate(template, params);
      }
    }

    return key;
  }

  // ------------------------------------------------------------------
  // Message registration
  // ------------------------------------------------------------------

  function addMessages(
    locale: string,
    incoming: I18nMessages,
    addOptions: I18nAddMessagesOptions = {},
  ): void {
    const normalizedLocale = normalizeLocale(locale);

    let payload: I18nMessages = incoming;

    if (addOptions.prefix) {
      payload = {
        [addOptions.prefix]: incoming,
      };
    }

    const current = messages[normalizedLocale] ?? {};

    messages = {
      ...messages,
      [normalizedLocale]: deepMergeMessages(current, payload),
    };
  }

  // ------------------------------------------------------------------
  // Locale management
  // ------------------------------------------------------------------

  function setLocale(locale: string, dir?: LocaleDirection): void {
    const previousLocale = ui.locale;
    const previousDir = ui.dir;

    ui.setLocale(locale, dir);

    if (ui.locale !== previousLocale || ui.dir !== previousDir) {
      notifyLocaleChange();
    }
  }

  function onLocaleChange(
    callback: (locale: string, dir: LocaleDirection) => void,
  ): () => void {
    localeChangeListeners.add(callback);

    return () => {
      localeChangeListeners.delete(callback);
    };
  }

  /**
   * If locale/dir were changed outside host-i18n,
   * e.g. directly via ui-store or settings import,
   * call sync() to notify listeners.
   */
  function sync(): void {
    if (
      lastNotified.locale !== ui.locale ||
      lastNotified.dir !== ui.dir
    ) {
      notifyLocaleChange();
    }
  }

  function notifyLocaleChange(): void {
    lastNotified = {
      locale: ui.locale,
      dir: ui.dir,
    };

    for (const listener of Array.from(localeChangeListeners)) {
      safeCall(listener, ui.locale, ui.dir);
    }
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    get locale(): string {
      return ui.locale;
    },

    get dir(): LocaleDirection {
      return ui.dir;
    },

    get isRtl(): boolean {
      return ui.isRtl;
    },

    get fallbackLocale(): string {
      return fallbackLocale;
    },

    get availableLocales(): string[] {
      return Object.keys(messages).sort();
    },

    t,
    addMessages,
    setLocale,
    onLocaleChange,
    sync,
  };
}

// --------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------

function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase().replace(/_/g, '-');
}

function normalizeMessageCatalog(
  catalog: Record<string, I18nMessages>,
): Record<string, I18nMessages> {
  const result: Record<string, I18nMessages> = {};

  for (const [locale, dictionary] of Object.entries(catalog)) {
    if (!dictionary || typeof dictionary !== 'object') {
      continue;
    }

    result[normalizeLocale(locale)] = dictionary;
  }

  return result;
}

function getLocaleCandidates(
  locale: string,
  fallbackLocale: string,
): string[] {
  const normalized = normalizeLocale(locale);
  const language = normalized.split('-')[0];

  const candidates: string[] = [normalized];

  if (language && language !== normalized) {
    candidates.push(language);
  }

  if (!candidates.includes(fallbackLocale)) {
    candidates.push(fallbackLocale);
  }

  return candidates;
}

function resolveMessage(
  dictionary: I18nMessages | undefined,
  key: string,
): string | undefined {
  if (!dictionary) {
    return undefined;
  }

  /**
   * Exact flat key has priority.
   * Example: "flat.key" can exist as literal key.
   */
  const exact = dictionary[key];

  if (typeof exact === 'string') {
    return exact;
  }

  if (!key.includes('.')) {
    return undefined;
  }

  let current: unknown = dictionary;

  for (const part of key.split('.')) {
    if (!isPlainObject(current)) {
      return undefined;
    }

    current = (current as I18nMessages)[part];
  }

  if (typeof current === 'string') {
    return current;
  }

  return undefined;
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  const safeParams = params ?? {};

  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(safeParams, name)) {
      return String(safeParams[name]);
    }

    return '';
  });
}

function deepMergeMessages(
  target: I18nMessages,
  source: I18nMessages,
): I18nMessages {
  const result: I18nMessages = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    const existing = result[key];

    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeMessages(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeCall<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): void {
  try {
    fn(...args);
  } catch (error) {
    console.error('[host-i18n] listener error', error);
  }
}