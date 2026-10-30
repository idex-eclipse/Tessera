import type {
  LocaleDirection,
  ThemeMode,
} from '../../../plugin-sdk/src/types';

import type { SettingsStore } from './settings-store.svelte.ts';

/**
 * Modular Printer UI v2
 * UI store.
 *
 * Source of truth: CONTEXT.md
 *
 * This store does not own persistence.
 * It is a reactive facade over settings.ui.
 *
 * Responsibilities:
 * - expose theme/locale/dir/sidebar state
 * - provide UI actions
 * - apply dir/theme attributes to DOM
 * - support RTL
 *
 * Non-responsibilities:
 * - business data
 * - Moonraker parsing
 * - plugin-to-plugin communication
 */

export interface UiDocumentLike {
  documentElement: {
    setAttribute(name: string, value: string): void;
  };
}

export interface MediaQueryListLike {
  matches: boolean;
  addEventListener(
    type: 'change',
    listener: (event: { matches: boolean }) => void,
  ): void;
}

export interface UiStoreOptions {
  /**
   * If true, store will apply DOM attributes.
   * Defaults to true only when real document exists.
   */
  applyDom?: boolean;

  /**
   * Injectable document for tests.
   */
  document?: UiDocumentLike;

  /**
   * Injectable matchMedia for tests.
   * Defaults to window.matchMedia when available.
   */
  matchMedia?: (query: string) => MediaQueryListLike;
}

export type UiStore = ReturnType<typeof createUiStore>;

/**
 * Единственный брейкпоинт хоста. CSS-медиазапросы обязаны использовать
 * то же значение (var() в @media не работает) — при смене править оба места.
 */
export const NARROW_BREAKPOINT = 768;
export const NARROW_QUERY = `(max-width: ${NARROW_BREAKPOINT}px)`;

/** Какая боковая панель сейчас открыта оверлеем на узком экране. */
export type MobilePanel = 'nav' | 'right' | null;

const RTL_LOCALE_PREFIXES = ['ar', 'he', 'fa', 'ur'];

export function createUiStore(
  settings: SettingsStore,
  options: UiStoreOptions = {},
) {
  const applyDomEnabled =
    options.applyDom ?? typeof document !== 'undefined';

  const doc =
    options.document ??
    (typeof document !== 'undefined'
      ? (document as unknown as UiDocumentLike)
      : undefined);

  /**
   * Apply initial DOM state.
   */
  applyDom();

  // ------------------------------------------------------------------
  // Narrow viewport / mobile panels
  //
  // Состояние временное и не пишется в settings: оно не должно затирать
  // десктопные sidebarCollapsed / rightPanelWidth.
  // ------------------------------------------------------------------

  let narrow = $state(false);
  let mobilePanel = $state<MobilePanel>(null);

  const matchMediaImpl =
    options.matchMedia ??
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? (query: string) => window.matchMedia(query)
      : undefined);

  if (matchMediaImpl) {
    const mql = matchMediaImpl(NARROW_QUERY);
    narrow = mql.matches;
    mql.addEventListener('change', (event) => {
      narrow = event.matches;
      if (!event.matches) mobilePanel = null;
    });
  }

  function openMobilePanel(panel: Exclude<MobilePanel, null>): void {
    if (!narrow) return;
    mobilePanel = panel;
  }

  function closeMobilePanel(): void {
    mobilePanel = null;
  }

  function toggleMobilePanel(panel: Exclude<MobilePanel, null>): void {
    if (mobilePanel === panel) closeMobilePanel();
    else openMobilePanel(panel);
  }

  // ------------------------------------------------------------------
  // DOM synchronization
  // ------------------------------------------------------------------

  function applyDom(): void {
    if (!applyDomEnabled || !doc) {
      return;
    }

    doc.documentElement.setAttribute('data-theme', settings.ui.theme);
    doc.documentElement.setAttribute('dir', settings.ui.dir);
    doc.documentElement.setAttribute('data-locale', settings.ui.locale);

    if (typeof document !== 'undefined') {
      if (settings.ui.accent) {
        document.documentElement.style.setProperty('--accent', settings.ui.accent);
      } else {
        document.documentElement.style.removeProperty('--accent');
      }
    }
  }

  
  /**
   * Re-apply DOM state after external settings mutation,
   * e.g. settings import.
   */
  function sync(): void {
    applyDom();
  }

  // ------------------------------------------------------------------
  // Theme
  // ------------------------------------------------------------------

  function setTheme(theme: ThemeMode): void {
    settings.setTheme(theme);
    applyDom();
    notifyThemeChange();
  }

  function toggleTheme(): void {
    setTheme(settings.ui.theme === 'dark' ? 'light' : 'dark');
  }

  const themeListeners = new Set<(theme: ThemeMode) => void>();

  function onThemeChange(callback: (theme: ThemeMode) => void): () => void {
    themeListeners.add(callback);
    return () => {
      themeListeners.delete(callback);
    };
  }

  function notifyThemeChange(): void {
    const current = settings.ui.theme;
    for (const listener of Array.from(themeListeners)) {
      try {
        listener(current);
      } catch (e) {
        console.error('[ui-store] theme listener error', e);
      }
    }
  }

  // ------------------------------------------------------------------
  // Locale / direction
  // ------------------------------------------------------------------

  function inferDirection(locale: string): LocaleDirection {
    const normalized = locale.toLowerCase();

    return RTL_LOCALE_PREFIXES.some(
      (prefix) =>
        normalized === prefix || normalized.startsWith(`${prefix}-`),
    )
      ? 'rtl'
      : 'ltr';
  }

  function setLocale(locale: string, dir?: LocaleDirection): void {
    settings.setLocale(locale, dir ?? inferDirection(locale));
    applyDom();
  }

  function setDir(dir: LocaleDirection): void {
    settings.setDir(dir);
    applyDom();
  }

  // ------------------------------------------------------------------
  // Sidebar
  // ------------------------------------------------------------------

  /**
   * На узком экране «свёрнуто» не имеет смысла (панель — оверлей), поэтому
   * toggleSidebar / toggleRightPanel управляют оверлеем: так же работают
   * хоткеи и любые другие вызовы. `collapsed: true` — закрыть, `false` — открыть.
   */
  function toggleMobile(panel: Exclude<MobilePanel, null>, collapsed?: boolean): void {
    if (collapsed === undefined) toggleMobilePanel(panel);
    else if (collapsed) {
      if (mobilePanel === panel) closeMobilePanel();
    } else openMobilePanel(panel);
  }

  function toggleSidebar(collapsed?: boolean): void {
    if (narrow) return toggleMobile('nav', collapsed);
    settings.toggleSidebar(collapsed);
  }

  function setSidebarWidth(width: number): void {
    settings.setSidebarWidth(width);
  }

  function toggleRightPanel(collapsed?: boolean): void {
    if (narrow) return toggleMobile('right', collapsed);
    settings.toggleRightPanel(collapsed);
  }

  function setRightPanelWidth(width: number): void {
    settings.setRightPanelWidth(width);
  }

  // ------------------------------------------------------------------
  // Background image
  // ------------------------------------------------------------------

  function setBackgroundImage(bgImage: string | null): boolean {
    return settings.setBackgroundImage(bgImage);
  }

  function setAccent(accent: string | null): boolean {
    const ok = settings.setAccent(accent);
    applyDom();
    return ok;
  }

  // ------------------------------------------------------------------
  // Fleet mode
  // ------------------------------------------------------------------

  function toggleFleet(open?: boolean): void {
    const next = open ?? !settings.ui.fleetOpen;
    settings.patchUi({ fleetOpen: next });
  }

  function setFleet(open: boolean): void {
    settings.patchUi({ fleetOpen: open });
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    get theme(): ThemeMode {
      return settings.ui.theme;
    },

    get locale(): string {
      return settings.ui.locale;
    },

    get dir(): LocaleDirection {
      return settings.ui.dir;
    },

    get isDark(): boolean {
      return settings.ui.theme === 'dark';
    },

    get isRtl(): boolean {
      return settings.ui.dir === 'rtl';
    },

    get sidebarCollapsed(): boolean {
      return settings.ui.sidebarCollapsed;
    },

    get sidebarWidth(): number {
      return settings.ui.sidebarWidth;
    },

    get rightPanelCollapsed(): boolean {
      return settings.ui.rightPanelCollapsed;
    },

    get rightPanelWidth(): number {
      return settings.ui.rightPanelWidth;
    },
  
    get bgImage(): string | null {
      return settings.ui.bgImage;
    },

    get accent(): string | null {
      return settings.ui.accent;
    },

    get fleetOpen(): boolean {
      return settings.ui.fleetOpen ?? false;
    },

    get isNarrow(): boolean {
      return narrow;
    },

    get mobilePanel(): MobilePanel {
      return mobilePanel;
    },

    openMobilePanel,
    closeMobilePanel,
    toggleMobilePanel,

    setTheme,
    toggleTheme,
    onThemeChange, 

    setLocale,
    setDir,
    inferDirection,

    toggleSidebar,
    setSidebarWidth,
    toggleRightPanel,
    setRightPanelWidth,
    setBackgroundImage,
    setAccent,
    toggleFleet,
    setFleet,

    sync,
    applyDom,
  };
}