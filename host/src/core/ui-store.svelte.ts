import type {
  LocaleDirection,
  ThemeMode,
} from '../../../plugin-sdk/src/types';

import type { SettingsStore } from './settings-store.svelte.ts';
import { readableAccent } from './appearance';
import type { CustomFont } from './types';

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
    style?: {
      setProperty(name: string, value: string): void;
      removeProperty(name: string): string;
    };
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
  let fontRevision = 0;
  let loadedFace: FontFace | null = null;
  let loadedDataUrl: string | null = null;
  applyDom();
  void applyFont();

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
    doc.documentElement.setAttribute('data-contrast', settings.ui.highContrast ? 'high' : 'normal');
    doc.documentElement.setAttribute('data-glyph-width', settings.ui.glyphWidth > 0 ? 'wide' : 'normal');
    doc.documentElement.setAttribute('dir', settings.ui.dir);
    doc.documentElement.setAttribute('data-locale', settings.ui.locale);

    const style = doc.documentElement.style;
    if (style) {
      const accent = settings.ui.accent ?? (settings.ui.theme === 'dark' ? '#669df6' : '#4285f4');
      if (settings.ui.highContrast) {
        const adjusted = readableAccent(accent, settings.ui.theme);
        style.setProperty('--accent', adjusted);
        style.setProperty('--accent-text', settings.ui.theme === 'dark' ? '#000000' : '#ffffff');
      } else if (settings.ui.accent) {
        style.setProperty('--accent', accent);
        style.removeProperty('--accent-text');
      } else {
        style.removeProperty('--accent');
        style.removeProperty('--accent-text');
      }
      style.setProperty('--font-scale', String(settings.ui.fontScale / 100));
      style.setProperty('--letter-spacing', `${settings.ui.letterSpacing / 100}em`);
      style.setProperty('--glyph-width', `${settings.ui.glyphWidth / 100}em`);
    }
  }

  /** Decode the mirrored font asynchronously; discard an outdated load after a later selection. */
  async function applyFont(): Promise<void> {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
    const revision = ++fontRevision;
    const font = settings.customFont;
    if (!font) {
      if (loadedFace) document.fonts.delete(loadedFace);
      loadedFace = null;
      loadedDataUrl = null;
      document.documentElement.style.removeProperty('--font-family');
      return;
    }
    if (font.dataUrl === loadedDataUrl) return;
    try {
      const face = new FontFace('Tessera Custom', `url("${font.dataUrl}")`);
      await face.load();
      if (revision !== fontRevision) return;
      if (loadedFace) document.fonts.delete(loadedFace);
      document.fonts.add(face);
      loadedFace = face;
      loadedDataUrl = font.dataUrl;
      document.documentElement.style.setProperty('--font-family', "'Tessera Custom', sans-serif");
    } catch {
      if (revision === fontRevision) {
        if (loadedFace) document.fonts.delete(loadedFace);
        loadedFace = null;
        loadedDataUrl = null;
        document.documentElement.style.removeProperty('--font-family');
      }
    }
  }

  
  /**
   * Re-apply DOM state after external settings mutation,
   * e.g. settings import.
   */
  function sync(): void {
    applyDom();
    void applyFont();
    notifyThemeChange();
  }

  // ------------------------------------------------------------------
  // Theme
  // ------------------------------------------------------------------

  function setTheme(theme: ThemeMode): void {
    settings.setTheme(theme);
    applyDom();
    notifyThemeChange();
  }

  /** Contrast changes the color tokens even though the public theme remains light/dark. */
  function setHighContrast(value: boolean): void {
    settings.setHighContrast(value);
    applyDom();
    notifyThemeChange();
  }

  /** Change all rem based text sizes while preserving browser zoom. */
  function setFontScale(value: number): void {
    settings.setFontScale(value);
    applyDom();
  }

  /** Apply the user's tracking to every inherited text style. */
  function setLetterSpacing(value: number): void {
    settings.setLetterSpacing(value);
    applyDom();
  }

  /** Expand glyph ink without transforming control boxes or hit targets. */
  function setGlyphWidth(value: number): void {
    settings.setGlyphWidth(value);
    applyDom();
  }

  /** Apply the validated file from settings and expose failure to the upload control. */
  async function setCustomFont(value: CustomFont | null): Promise<boolean> {
    if (!settings.setCustomFont(value)) return false;
    await applyFont();
    return true;
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

    get highContrast(): boolean { return settings.ui.highContrast; },
    get fontScale(): number { return settings.ui.fontScale; },
    get letterSpacing(): number { return settings.ui.letterSpacing; },
    get glyphWidth(): number { return settings.ui.glyphWidth; },
    get customFont(): CustomFont | null { return settings.customFont; },

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

    get logoAnimated(): boolean {
      return settings.ui.logoAnimated;
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
    setHighContrast,
    setFontScale,
    setLetterSpacing,
    setGlyphWidth,
    setCustomFont,
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
    setLogoAnimated: (animated: boolean) => settings.setLogoAnimated(animated),
    toggleFleet,
    setFleet,

    sync,
    applyDom,
  };
}
