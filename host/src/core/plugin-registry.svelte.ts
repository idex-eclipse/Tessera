import type {
  BannerContribution,
  OverlayContribution,
  PageContribution,
  PluginManifest,
  RightPanelContribution,
  WidgetContribution,
  ChipContribution,
  QuickChipLayoutItem,
} from '../../../plugin-sdk/src/types';

import type {
  DashboardWidgetLayoutItem,
  SettingsStore,
} from './settings-store.svelte.ts';

import { buildDefaultLayout } from './default-layout.ts';
import { buildDefaultChips } from './default-chips.ts';

/**
 * Modular Printer UI v2
 * Plugin Registry.
 *
 * Source of truth: CONTEXT.md
 *
 * Two responsibilities:
 * 1. Registry of plugin contributions (pages, widgets)
 * 2. User preferences per-printer (page visibility, provider selection, dashboard layout)
 *
 * Explicitly absent:
 * - capabilities / priority
 * - getBestProvider / auto-selection
 * - shouldShowTabs by priority
 *
 * "What to show" is decided ONLY by the user.
 */

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface RegisteredOverlay {
  pluginId: string;
  contribution: OverlayContribution;
}

export interface RegisteredBanner {
  pluginId: string;
  contribution: BannerContribution;
}

export interface RegisteredRightPanel {
  pluginId: string;
  contribution: RightPanelContribution;
}

export interface RegisteredPage {
  pluginId: string;
  contribution: PageContribution;
}

export interface RegisteredWidget {
  pluginId: string;
  contribution: WidgetContribution;
}

export interface RegisteredChip {
  pluginId: string;
  contribution: ChipContribution;
}

export type PluginRegistry = ReturnType<typeof createPluginRegistry>;

// ------------------------------------------------------------------
// Factory
// ------------------------------------------------------------------

export function createPluginRegistry(settings: SettingsStore) {
  /**
   * Reactive state: registered contributions.
   */
  let pages = $state<RegisteredPage[]>([]);
  let widgets = $state<RegisteredWidget[]>([]);
  let overlays = $state<RegisteredOverlay[]>([]);
  let banners = $state<RegisteredBanner[]>([]);
  let rightPanel = $state<RegisteredRightPanel | null>(null);
  let chips = $state<RegisteredChip[]>([]); 

  // ------------------------------------------------------------------
  // Registration / unregistration
  // ------------------------------------------------------------------

  function registerPlugin(manifest: PluginManifest): void {
    unregisterPlugin(manifest.id);

    if (manifest.pages && manifest.pages.length > 0) {
      const newPages: RegisteredPage[] = manifest.pages.map((contribution) => ({
        pluginId: manifest.id,
        contribution,
      }));

      pages = [...pages, ...newPages];
    }

    if (manifest.widgets && manifest.widgets.length > 0) {
      const newWidgets: RegisteredWidget[] = manifest.widgets.map((contribution) => ({
        pluginId: manifest.id,
        contribution,
      }));

      widgets = [...widgets, ...newWidgets];
    }

    if (manifest.overlays && manifest.overlays.length > 0) {
      const newOverlays: RegisteredOverlay[] = manifest.overlays.map((contribution) => ({
        pluginId: manifest.id,
        contribution,
      }));

      overlays = [...overlays, ...newOverlays];
    }

    if (manifest.banners && manifest.banners.length > 0) {
      const newBanners: RegisteredBanner[] = manifest.banners.map((contribution) => ({
        pluginId: manifest.id,
        contribution,
      }));

      banners = [...banners, ...newBanners];
    }

    if (manifest.rightPanel) {
      rightPanel = {
        pluginId: manifest.id,
        contribution: manifest.rightPanel,
      };
    }

    if (manifest.chips && manifest.chips.length > 0) {
      const newChips: RegisteredChip[] = manifest.chips.map((contribution) => ({
        pluginId: manifest.id,
        contribution,
      }));

      chips = [...chips, ...newChips];
    }
  }

  function unregisterPlugin(pluginId: string): void {
    pages = pages.filter((page) => page.pluginId !== pluginId);
    widgets = widgets.filter((widget) => widget.pluginId !== pluginId);
    overlays = overlays.filter((overlay) => overlay.pluginId !== pluginId);
    banners = banners.filter((banner) => banner.pluginId !== pluginId);
    chips = chips.filter((chip) => chip.pluginId !== pluginId);

    if (rightPanel && rightPanel.pluginId === pluginId) {
      rightPanel = null;
    }
  }

  // ------------------------------------------------------------------
  // Registry queries
  // ------------------------------------------------------------------

  function getPages(): RegisteredPage[] {
    return pages;
  }

  function getWidgets(): RegisteredWidget[] {
    return widgets;
  }

  function getWidgetTypes(): string[] {
    const types = new Set<string>();

    for (const widget of widgets) {
      types.add(widget.contribution.type);
    }

    return Array.from(types).sort();
  }

  function getProvidersForType(type: string): RegisteredWidget[] {
    return widgets.filter((widget) => widget.contribution.type === type);
  }

  function hasMultipleProviders(type: string): boolean {
    return getProvidersForType(type).length > 1;
  }

  function getOverlays(): RegisteredOverlay[] {
    return overlays;
  }

  function getBanners(): RegisteredBanner[] {
    return banners;
  }

  function getChips(): RegisteredChip[] {
    return chips;
  }

  function getRightPanel(): RegisteredRightPanel | undefined {
    return rightPanel ?? undefined;
  }

  /**
   * Returns the effective provider for a widget type on a given printer.
   *
   * Rules (from CONTEXT.md):
   * - If only one provider exists, it is used implicitly.
   * - If multiple providers exist, the user's explicit selection is used.
   * - If no explicit selection is stored and multiple providers exist,
   *   the first registered provider is used as a fallback.
   *
   * This is NOT "getBestProvider" — there is no priority or capability logic.
   * It simply resolves what the user chose (or the only option available).
   */
  function getEffectiveProvider(
    printerId: string,
    widgetType: string,
  ): RegisteredWidget | null {
    const providers = getProvidersForType(widgetType);

    if (providers.length === 0) {
      return null;
    }

    if (providers.length === 1) {
      return providers[0] ?? null;;
    }

    // Multiple providers: check user's explicit selection.
    const selectedProviderId = settings.getWidgetProvider(printerId, widgetType);

    if (selectedProviderId) {
      const selected = providers.find(
        (w) => w.contribution.provider === selectedProviderId,
      );

      if (selected) {
        return selected;
      }
    }

    // Fallback: first registered provider (not "best", just first).
    return providers[0] ?? null;;
  }

  // ------------------------------------------------------------------
  // Per-printer preferences: page visibility
  // ------------------------------------------------------------------

  function getVisiblePages(printerId: string): RegisteredPage[] {
    return pages.filter((page) => {
      return settings.getPageVisibility(printerId, page.contribution.id);
    });
  }

  function isPageVisible(printerId: string, pageId: string): boolean {
    return settings.getPageVisibility(printerId, pageId);
  }

  function setPageVisibility(
    printerId: string,
    pageId: string,
    visible: boolean,
  ): void {
    settings.setPageVisibility(printerId, pageId, visible);
  }

  // ------------------------------------------------------------------
  // Per-printer preferences: widget provider selection
  // ------------------------------------------------------------------

  function getSelectedProvider(
    printerId: string,
    widgetType: string,
  ): string | undefined {
    return settings.getWidgetProvider(printerId, widgetType);
  }

  /**
   * Sets the user's explicit provider selection.
   * Only meaningful when hasMultipleProviders(type) is true.
   */
  function setSelectedProvider(
    printerId: string,
    widgetType: string,
    providerId: string,
  ): void {
    settings.setWidgetProvider(printerId, widgetType, providerId);
  }

  function clearSelectedProvider(printerId: string, widgetType: string): void {
    settings.clearWidgetProvider(printerId, widgetType);
  }

    // ------------------------------------------------------------------
  // Per-printer preferences: dashboard layout
  // ------------------------------------------------------------------

  function getDashboardLayout(printerId: string): DashboardWidgetLayoutItem[] {
    const stored = settings.getPrinterSettings(printerId);
    if (stored.dashboardLayoutCustomized) return stored.dashboardLayout;

    // Виртуальный стандарт: состав — константа хоста, размеры/провайдер — из реестра
    return buildDefaultLayout((type) => {
      const providers = getProvidersForType(type);
      if (providers.length === 0) return null;
      const chosenProviderId = stored.widgetProviders[type];
      const chosen = chosenProviderId
        ? providers.find((p) => p.contribution.provider === chosenProviderId)
        : null;
      const picked = chosen ?? providers[0];
      if (!picked) return null;
      return {
        provider: picked.contribution.provider,
        defaultSize: picked.contribution.defaultSize,
      };
    });
  }

  function setDashboardLayout(
    printerId: string,
    layout: DashboardWidgetLayoutItem[],
  ): void {
    settings.setDashboardLayout(printerId, layout); // флаг customized=true ставит store
  }

  function resetDashboardLayout(printerId: string): void {
    settings.resetDashboardLayout(printerId);       // флаг customized=false ставит store
  }

  // ------------------------------------------------------------------
  // Per-printer preferences: quick chips
  // ------------------------------------------------------------------

  function getQuickChips(printerId: string): QuickChipLayoutItem[] {
    const stored = settings.getPrinterSettings(printerId);
    if (stored.quickChipsCustomized) return stored.quickChips;

    // Виртуальный стандарт: extruder + heater_bed + livez, провайдеры из константы;
    // незарегистрированные вклады пропускаются (sanitize)
    return buildDefaultChips((type, provider) =>
      getChips().some(
        (c) => c.contribution.type === type && c.contribution.provider === provider,
      ),
    );
  }

  function setQuickChips(printerId: string, chips: QuickChipLayoutItem[]): void {
    settings.setQuickChips(printerId, chips);
  }

  function resetQuickChips(printerId: string): void {
    settings.resetQuickChips(printerId);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    // Registration
    registerPlugin,
    unregisterPlugin,

    // Registry queries
    getPages,
    getWidgets,
    getWidgetTypes,
    getProvidersForType,
    hasMultipleProviders,
    getEffectiveProvider,
    getOverlays,
    getBanners,
    getRightPanel,
    getChips,

    // Per-printer: page visibility
    getVisiblePages,
    isPageVisible,
    setPageVisibility,

    // Per-printer: widget provider selection
    getSelectedProvider,
    setSelectedProvider,
    clearSelectedProvider,

    // Per-printer: dashboard layout
    getDashboardLayout,
    setDashboardLayout,
    resetDashboardLayout,
    getQuickChips, 
    setQuickChips, 
    resetQuickChips,
  };
}