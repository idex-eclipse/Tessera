import { describe, expect, it } from 'vitest';

import {
  createHostI18n,
  type HostI18nOptions,
} from '../host-i18n.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { createUiStore } from '../ui-store.svelte.ts';
import { MemoryStorage } from '../storage';

import {
  CORE_LOCALE_OPTIONS,
  registerCoreLocales,
} from '../../i18n/index.ts';

const testMessages = {
  en: {
    greeting: 'Hello {name}',
    onlyEn: 'English only',
    'flat.key': 'Flat en',

    nested: {
      key: 'Nested en',
      deep: {
        key: 'Deep en',
      },
    },
  },

  ru: {
    greeting: 'Привет {name}',
    onlyRu: 'Только русский',

    nested: {
      key: 'Вложенный ru',
    },
  },
};

function setup(options: HostI18nOptions = {}) {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const ui = createUiStore(settings, { applyDom: false });

  const i18n = createHostI18n(ui, {
    fallbackLocale: 'en',
    messages: testMessages,
    ...options,
  });

  return { storage, settings, ui, i18n };
}

describe('host-i18n / basic translation', () => {
  it('returns key when translation is missing', () => {
    const { i18n } = setup();

    expect(i18n.t('missing.key')).toBe('missing.key');
  });

  it('translates current locale', () => {
    const { i18n } = setup();

    expect(i18n.locale).toBe('en');
    expect(i18n.t('onlyEn')).toBe('English only');

    i18n.setLocale('ru');

    expect(i18n.locale).toBe('ru');
    expect(i18n.t('onlyRu')).toBe('Только русский');
  });

  it('falls back to fallback locale when key is missing in current locale', () => {
    const { i18n } = setup();

    i18n.setLocale('ru');

    expect(i18n.t('onlyEn')).toBe('English only');
  });

  it('supports locale variants like ru-RU by falling back to ru', () => {
    const { i18n } = setup();

    i18n.setLocale('ru-RU');

    expect(i18n.locale).toBe('ru-RU');
    expect(i18n.t('onlyRu')).toBe('Только русский');
  });
});

describe('host-i18n / key resolution', () => {
  it('supports nested keys', () => {
    const { i18n } = setup();

    expect(i18n.t('nested.key')).toBe('Nested en');
    expect(i18n.t('nested.deep.key')).toBe('Deep en');

    i18n.setLocale('ru');

    expect(i18n.t('nested.key')).toBe('Вложенный ru');

    /**
     * ru does not have nested.deep.key, fallback to en.
     */
    expect(i18n.t('nested.deep.key')).toBe('Deep en');
  });

  it('supports flat dotted keys', () => {
    const { i18n } = setup();

    expect(i18n.t('flat.key')).toBe('Flat en');
  });
});

describe('host-i18n / interpolation', () => {
  it('interpolates params', () => {
    const { i18n } = setup();

    expect(i18n.t('greeting', { name: 'World' })).toBe('Hello World');

    i18n.setLocale('ru');

    expect(i18n.t('greeting', { name: 'Иван' })).toBe('Привет Иван');
  });

  it('replaces missing params with empty string', () => {
    const { i18n } = setup();

    expect(i18n.t('greeting')).toBe('Hello ');
  });
});

describe('host-i18n / addMessages', () => {
  it('merges messages without overwriting existing sibling keys', () => {
    const { i18n } = setup();

    i18n.addMessages('en', {
      extra: 'Extra',
      nested: {
        added: 'Added nested',
      },
    });

    expect(i18n.t('extra')).toBe('Extra');
    expect(i18n.t('nested.added')).toBe('Added nested');
    expect(i18n.t('nested.key')).toBe('Nested en');
  });

  it('supports plugin prefix namespacing', () => {
    const { i18n } = setup();

    i18n.addMessages(
      'en',
      {
        title: 'Console',
      },
      {
        prefix: '@core/console',
      },
    );

    expect(i18n.t('@core/console.title')).toBe('Console');
  });
});

describe('host-i18n / locale change', () => {
  it('updates ui locale and notifies listeners', () => {
    const { i18n, ui } = setup();

    let last: { locale: string; dir: string } | null = null;

    const unsubscribe = i18n.onLocaleChange((locale, dir) => {
      last = { locale, dir };
    });

    i18n.setLocale('ru');

    expect(ui.locale).toBe('ru');
    expect(ui.dir).toBe('ltr');
    expect(last).toEqual({ locale: 'ru', dir: 'ltr' });

    i18n.setLocale('ar');

    expect(ui.dir).toBe('rtl');
    expect(last).toEqual({ locale: 'ar', dir: 'rtl' });

    unsubscribe();

    i18n.setLocale('en');

    expect(last).toEqual({ locale: 'ar', dir: 'rtl' });
  });

  it('sync() notifies after direct ui-store locale mutation', () => {
    const { i18n, ui } = setup();

    let calls = 0;

    i18n.onLocaleChange(() => {
      calls += 1;
    });

    ui.setLocale('ru');

    expect(calls).toBe(0);

    i18n.sync();

    expect(calls).toBe(1);

    i18n.sync();

    expect(calls).toBe(1);
  });
});

describe('host-i18n / core locales', () => {
  it('registers en and ru core dictionaries', () => {
    const storage = new MemoryStorage();
    const settings = createSettingsStore({ storage });
    const ui = createUiStore(settings, { applyDom: false });

    const i18n = createHostI18n(ui);

    registerCoreLocales(i18n);

    expect(i18n.availableLocales).toEqual(['en', 'ru']);

    expect(i18n.t('locale.name')).toBe('English');
    expect(i18n.t('settings.title')).toBe('Settings');

    i18n.setLocale('ru');

    expect(i18n.t('locale.name')).toBe('Русский');
    expect(i18n.t('settings.title')).toBe('Настройки');
    expect(i18n.t('settings.legacy.title')).toBe(
      'Формат настроек изменился',
    );
  });

  it('provides core locale options for future selector', () => {
    expect(CORE_LOCALE_OPTIONS.length).toBeGreaterThanOrEqual(2);

    const codes = CORE_LOCALE_OPTIONS.map((item) => item.code);

    expect(codes).toContain('en');
    expect(codes).toContain('ru');
  });
});