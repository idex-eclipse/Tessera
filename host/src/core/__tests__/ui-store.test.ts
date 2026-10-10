import { describe, expect, it } from 'vitest';

import { createSettingsStore } from '../settings-store.svelte.ts';
import { createUiStore } from '../ui-store.svelte.ts';
import { MemoryStorage } from '../storage';

function createFakeDocument() {
  const attrs: Record<string, string> = {};

  return {
    attrs,
    documentElement: {
      setAttribute(name: string, value: string): void {
        attrs[name] = value;
      },
    },
  };
}

function setup(options: { applyDom?: boolean } = {}) {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const doc = createFakeDocument();

  const ui = createUiStore(settings, {
    applyDom: true,
    document: doc,
    ...options,
  });

  return { storage, settings, ui, doc };
}

describe('ui-store / initial state', () => {
  it('exposes defaults and applies initial DOM attributes', () => {
    const { ui, doc } = setup();

    expect(ui.theme).toBe('light');
    expect(ui.locale).toBe('en');
    expect(ui.dir).toBe('ltr');
    expect(ui.isDark).toBe(false);
    expect(ui.isRtl).toBe(false);
    expect(ui.sidebarCollapsed).toBe(false);
    expect(ui.sidebarWidth).toBe(280);

    expect(doc.attrs['data-theme']).toBe('light');
    expect(doc.attrs['dir']).toBe('ltr');
    expect(doc.attrs['data-locale']).toBe('en');
  });
});

describe('ui-store / theme', () => {
  it('sets theme, persists through settings and updates DOM', () => {
    const { ui, settings, doc } = setup();

    ui.setTheme('dark');

    expect(ui.theme).toBe('dark');
    expect(ui.isDark).toBe(true);
    expect(settings.ui.theme).toBe('dark');
    expect(doc.attrs['data-theme']).toBe('dark');
  });

  it('toggles theme', () => {
    const { ui } = setup();

    expect(ui.theme).toBe('light');

    ui.toggleTheme();
    expect(ui.theme).toBe('dark');

    ui.toggleTheme();
    expect(ui.theme).toBe('light');
  });
});

describe('ui-store / locale and direction', () => {
  it('sets locale with explicit direction', () => {
    const { ui, settings, doc } = setup();

    ui.setLocale('ru', 'ltr');

    expect(ui.locale).toBe('ru');
    expect(ui.dir).toBe('ltr');
    expect(settings.ui.locale).toBe('ru');
    expect(settings.ui.dir).toBe('ltr');

    expect(doc.attrs['data-locale']).toBe('ru');
    expect(doc.attrs['dir']).toBe('ltr');
  });

  it('infers RTL for known RTL locales', () => {
    const { ui } = setup();

    ui.setLocale('ar');
    expect(ui.dir).toBe('rtl');
    expect(ui.isRtl).toBe(true);

    ui.setLocale('ar-MA');
    expect(ui.dir).toBe('rtl');

    ui.setLocale('he');
    expect(ui.dir).toBe('rtl');

    ui.setLocale('fa');
    expect(ui.dir).toBe('rtl');

    ui.setLocale('ur');
    expect(ui.dir).toBe('rtl');

    ui.setLocale('en-US');
    expect(ui.dir).toBe('ltr');
    expect(ui.isRtl).toBe(false);
  });

  it('allows manual dir override', () => {
    const { ui, settings, doc } = setup();

    ui.setLocale('en');
    ui.setDir('rtl');

    expect(ui.dir).toBe('rtl');
    expect(settings.ui.dir).toBe('rtl');
    expect(doc.attrs['dir']).toBe('rtl');
  });
});

describe('ui-store / sidebar', () => {
  it('toggles sidebar and sets width', () => {
    const { ui, settings } = setup();

    expect(ui.sidebarCollapsed).toBe(false);

    ui.toggleSidebar();
    expect(ui.sidebarCollapsed).toBe(true);
    expect(settings.ui.sidebarCollapsed).toBe(true);

    ui.toggleSidebar(false);
    expect(ui.sidebarCollapsed).toBe(false);

    ui.setSidebarWidth(320);
    expect(ui.sidebarWidth).toBe(320);
    expect(settings.ui.sidebarWidth).toBe(320);
  });

  it('ignores invalid sidebar width via settings-store validation', () => {
    const { ui } = setup();

    ui.setSidebarWidth(Number.NaN);
    expect(ui.sidebarWidth).toBe(280);

    ui.setSidebarWidth(-10);
    expect(ui.sidebarWidth).toBe(280);

    ui.setSidebarWidth(300);
    expect(ui.sidebarWidth).toBe(300);
  });
});

describe('ui-store / sync', () => {
  it('re-applies DOM after direct settings mutation', () => {
    const { ui, settings, doc } = setup();

    settings.patchUi({
      theme: 'dark',
      locale: 'ru',
      dir: 'rtl',
    });

    expect(ui.theme).toBe('dark');
    expect(ui.locale).toBe('ru');
    expect(ui.dir).toBe('rtl');

    /**
     * DOM has not been synchronized yet because mutation bypassed ui-store.
     */
    expect(doc.attrs['data-theme']).toBe('light');
    expect(doc.attrs['data-locale']).toBe('en');
    expect(doc.attrs['dir']).toBe('ltr');

    ui.sync();

    expect(doc.attrs['data-theme']).toBe('dark');
    expect(doc.attrs['data-locale']).toBe('ru');
    expect(doc.attrs['dir']).toBe('rtl');
  });
});

describe('ui-store / environment safety', () => {
  it('does not throw when DOM is unavailable', () => {
    const storage = new MemoryStorage();
    const settings = createSettingsStore({ storage });

    const ui = createUiStore(settings, {
      applyDom: true,
      document: undefined,
    });

    expect(() => ui.setTheme('dark')).not.toThrow();
    expect(() => ui.setLocale('ru')).not.toThrow();
    expect(() => ui.toggleSidebar()).not.toThrow();

    expect(ui.theme).toBe('dark');
    expect(ui.locale).toBe('ru');
  });
});