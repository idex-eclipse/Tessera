/**
 * Modular Printer UI v2
 * Host-internal contracts.
 *
 * These types are NOT part of the public plugin API surface.
 */

import type {
  ConnectionStatus,
  LocaleDirection,
  ThemeMode,
  QuickChipLayoutItem,
} from '../../../plugin-sdk/src/types';

import type {
  RegisteredBanner,
  RegisteredChip,
  RegisteredHotkey,
  RegisteredOverlay,
  RegisteredPage,
  RegisteredPrinterPanel,
  RegisteredRightPanel,
  RegisteredWidget,
} from './surfaces';

export * from '../../../plugin-sdk/src/types';
export type * from './surfaces';

/**
 * Stored printer record.
 * localStorage key: mpu:v2:printers
 */
export interface PrinterRecord {
  id: string;
  name: string;
  url: string;
}

/**
 * Remote plugin record.
 * localStorage key: mpu:v2:plugins
 *
 * Core plugins are not stored here.
 */
export interface RemotePluginRecord {
  manifestUrl: string;
  enabled: boolean;
  printerIds: string[];
  /** Происхождение установки (каталог / URL). */
  source?: 'catalog' | 'url';
  /** Версия на момент установки — для бейджа «доступно обновление». */
  installedVersion?: string;
}

/**
 * Global UI state.
 * localStorage key: mpu:v2:ui
 */
export interface UiState {
  theme: ThemeMode;
  locale: string;
  dir: LocaleDirection;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelWidth: number;
  bgImage: string | null;
  accent: string | null;
  fleetOpen?: boolean;
  fleetPanels: FleetPanelLayoutItem[];
  fleetPanelsCustomized: boolean;
  /**
   * Переопределения горячих клавиш (device-global).
   * Ключ `${pluginId}:${hotkeyId}`; строка — новая комбинация,
   * null — клавиша отключена пользователем. Нет ключа — значение по умолчанию.
   */
  hotkeyOverrides: Record<string, string | null>;
}

/**
 * Page visibility per printer.
 * Key is a global page id, typically `${pluginId}:${pageId}`.
 */
export interface PageVisibilityMap {
  [globalPageId: string]: boolean;
}

/**
 * Explicit widget provider selection per widget type.
 * Key: widget type
 * Value: provider id
 *
 * Written only when there is more than one provider for a type.
 */
export interface WidgetProviderSelectionMap {
  [widgetType: string]: string | undefined;
}

/**
 * One placed widget instance on the dashboard.
 */
export interface DashboardWidgetLayoutItem {
  /** Internal instance id, not part of plugin manifest */
  instanceId: string;

  /** Widget type from WidgetContribution */
  type: string;

  /** Explicit provider id */
  provider: string;

  /** Grid coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One fleet panel layout entry (device-global).
 * Position in array = display order in fleet cards.
 * visible=false = hidden in all fleet cards.
 */
export interface FleetPanelLayoutItem {
  pluginId: string;
  contributionId: string;
  visible: boolean;
}

/**
 * Per-printer settings.
 * localStorage key: mpu:v2:settings:<printerId>
 */
export interface PrinterSettingsState {
  pages: PageVisibilityMap;
  widgetProviders: WidgetProviderSelectionMap;
  dashboardLayout: DashboardWidgetLayoutItem[];
  /** false/undefined = виртуальный стандартный layout. */
  dashboardLayoutCustomized?: boolean;
  quickChips: QuickChipLayoutItem[];
  quickChipsCustomized?: boolean;
}

/**
 * Arbitrary per-plugin settings object.
 * localStorage key: mpu:v2:plugin-settings:<printerId>:<pluginId>
 */
export type PluginSettingsState = Record<string, unknown>;

/**
 * Registry public read surface.
 *
 * No capabilities.
 * No priority.
 * No automatic "best provider" selection.
 */
export interface PluginRegistryView {
  getPages(): RegisteredPage[];
  getWidgetTypes(): string[];
  getProvidersForType(type: string): RegisteredWidget[];

  getOverlays(): RegisteredOverlay[];
  getBanners(): RegisteredBanner[];
  getChips(): RegisteredChip[];
  getPrinterPanels(): RegisteredPrinterPanel[];
  getHotkeys(): RegisteredHotkey[];
  getRightPanel(): RegisteredRightPanel | undefined;
}

/**
 * Infrastructure-only connection state for a printer.
 * Used by host badges and offline overlay.
 *
 * Must NOT contain business data like temperatures, files, print state.
 */
export interface PrinterConnectionState {
  printerId: string;
  url: string;
  status: ConnectionStatus;
  lastSuccessfulAt: number | null;
}

/**
 * Static localStorage schema keys with fixed names.
 */
export interface StaticStorageSchemaV2 {
  'mpu:v2:printers': PrinterRecord[];
  'mpu:v2:activePrinter': string;
  'mpu:v2:plugins': RemotePluginRecord[];
  'mpu:v2:ui': UiState;
}

/**
 * Dynamic localStorage key shapes.
 */
export type PrinterSettingsStorageKey = `mpu:v2:settings:${string}`;
export type PluginSettingsStorageKey = `mpu:v2:plugin-settings:${string}:${string}`;