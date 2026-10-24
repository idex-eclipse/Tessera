import type { PluginManifest, QuickChipLayoutItem } from '../../../plugin-sdk/src/types';

import {
  SINGLETON_SURFACES,
  SURFACE_KINDS,
  contributionsOf,
  type Registered,
  type RegisteredBanner,
  type RegisteredChip,
  type RegisteredHotkey,
  type RegisteredOverlay,
  type RegisteredPage,
  type RegisteredPrinterPanel,
  type RegisteredRightPanel,
  type RegisteredWidget,
  type SurfaceKind,
} from './surfaces.ts';

import type {
  DashboardWidgetLayoutItem,
  SettingsStore,
} from './settings-store.svelte.ts';

import { buildDefaultLayout } from './default-layout.ts';
import { buildDefaultChips } from './default-chips.ts';
import { findFreeSpot } from './layout-utils.ts';

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

export type {
  RegisteredBanner,
  RegisteredChip,
  RegisteredHotkey,
  RegisteredOverlay,
  RegisteredPage,
  RegisteredPrinterPanel,
  RegisteredRightPanel,
  RegisteredWidget,
} from './surfaces.ts';

export type PluginRegistry = ReturnType<typeof createPluginRegistry>;

// ------------------------------------------------------------------
// Factory
// ------------------------------------------------------------------

export function createPluginRegistry(settings: SettingsStore) {
  /**
   * Reactive state: registered contributions, один список на вид поверхности.
   * Порядок внутри списка = порядок регистрации плагинов.
   */
  type SurfaceStore = { [K in SurfaceKind]: Registered<K>[] };

  const emptyStore = (): SurfaceStore => ({
    pages: [],
    widgets: [],
    overlays: [],
    banners: [],
    chips: [],
    printerPanels: [],
    hotkeys: [],
  });

  let surfaces = $state<SurfaceStore>(emptyStore());
  let rightPanel = $state<RegisteredRightPanel | null>(null);

  // ------------------------------------------------------------------
  // Registration / unregistration
  // ------------------------------------------------------------------

  function appendSurface<K extends SurfaceKind>(kind: K, pluginId: string, manifest: PluginManifest): void {
    const list = contributionsOf(manifest, kind);
    if (list.length === 0) return;

    const added = list.map((contribution) => ({ pluginId, contribution })) as Registered<K>[];
    surfaces[kind] = [...(surfaces[kind] as Registered<K>[]), ...added] as SurfaceStore[K];
  }

  function registerPlugin(manifest: PluginManifest): void {
    unregisterPlugin(manifest.id);

    for (const kind of SURFACE_KINDS) {
      appendSurface(kind, manifest.id, manifest);
    }

    if (SINGLETON_SURFACES.includes('rightPanel') && manifest.rightPanel) {
      rightPanel = { pluginId: manifest.id, contribution: manifest.rightPanel };
    }
  }

  function dropSurface<K extends SurfaceKind>(kind: K, pluginId: string): void {
    const current = surfaces[kind] as Registered<K>[];
    if (current.some((r) => r.pluginId === pluginId)) {
      surfaces[kind] = current.filter((r) => r.pluginId !== pluginId) as SurfaceStore[K];
    }
  }

  function unregisterPlugin(pluginId: string): void {
    for (const kind of SURFACE_KINDS) {
      dropSurface(kind, pluginId);
    }

    if (rightPanel && rightPanel.pluginId === pluginId) {
      rightPanel = null;
    }
  }

  // ------------------------------------------------------------------
  // Registry queries
  // ------------------------------------------------------------------

  function getPages(): RegisteredPage[] {
    return surfaces.pages;
  }

  function getWidgets(): RegisteredWidget[] {
    return surfaces.widgets;
  }

  function getWidgetTypes(): string[] {
    const types = new Set<string>();

    for (const widget of surfaces.widgets) {
      types.add(widget.contribution.type);
    }

    return Array.from(types).sort();
  }

  function getProvidersForType(type: string): RegisteredWidget[] {
    return surfaces.widgets.filter((widget) => widget.contribution.type === type);
  }

  function hasMultipleProviders(type: string): boolean {
    return getProvidersForType(type).length > 1;
  }

  function getOverlays(): RegisteredOverlay[] {
    return surfaces.overlays;
  }

  function getBanners(): RegisteredBanner[] {
    return surfaces.banners;
  }

  function getChips(): RegisteredChip[] {
    return surfaces.chips;
  }

  function getPrinterPanels(): RegisteredPrinterPanel[] {
    return surfaces.printerPanels;
  }

  function getHotkeys(): RegisteredHotkey[] {
    return surfaces.hotkeys;
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
      return providers[0] ?? null;
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
    return providers[0] ?? null;
  }

  // ------------------------------------------------------------------
  // Per-printer preferences: page visibility
  // ------------------------------------------------------------------

  function getVisiblePages(printerId: string): RegisteredPage[] {
    return surfaces.pages.filter((page) => {
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

  const items = buildDefaultLayout((type) => {
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

  // Расставляем элементы через findFreeSpot (simple greedy packing)
  const placed: DashboardWidgetLayoutItem[] = [];
  for (const item of items) {
    const spot = findFreeSpot(placed, item.w, item.h);
    placed.push({ ...item, x: spot.x, y: spot.y });
  }

  return placed;
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
    getPrinterPanels,
    getHotkeys,

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