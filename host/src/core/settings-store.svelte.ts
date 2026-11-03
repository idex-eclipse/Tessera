import type {
  DashboardWidgetLayoutItem,
  FleetPanelLayoutItem,
  PluginSettingsState,
  PrinterRecord,
  PrinterSettingsState,
  RemotePluginRecord,
  UiState,
} from './types';
import type { LocaleDirection, ThemeMode, QuickChipLayoutItem } from '../../../plugin-sdk/src/types';

import {
  MemoryStorage,
  readJson,
  removeItem,
  writeJson,
  type StorageLike,
} from './storage';

import { isPluginSynced, isDashboardSynced, onSyncChange, setPluginSynced, setDashboardSynced } from './settings-sync.svelte';

/**
 * Modular Printer UI v2
 * Settings store.
 *
 * Source of truth: CONTEXT.md
 *
 * Rules:
 * - all settings live in browser localStorage
 * - schema prefix: mpu:v2:*
 * - no backend
 * - no automatic migration from old schema
 * - legacy schema only detected, then user decides export/reset
 */

export type {
  DashboardWidgetLayoutItem,
  FleetPanelLayoutItem,
  PluginSettingsState,
  PrinterRecord,
  PrinterSettingsState,
  RemotePluginRecord,
  UiState,
};

export const BG_IMAGE_MAX_CHARS = 2_500_000;

export interface LegacySchemaInfo {
  detected: boolean;
  keys: string[];
}

export interface SettingsStoreOptions {
  storage?: StorageLike;
  /**
   * Bootstrap: добавить дефолтный принтер MyPrinter на текущий origin,
   * если список принтеров пуст. По умолчанию true только в browser-mode
   * (storage не инжектирован и window существует). Тесты с инжектированным
   * storage получают false — чистый пустой storage.
   */
  createDefaultPrinter?: boolean;
}

export const SETTINGS_STORAGE_KEYS = {
  printers: 'mpu:v2:printers',
  activePrinter: 'mpu:v2:activePrinter',
  plugins: 'mpu:v2:plugins',
  ui: 'mpu:v2:ui',
} as const;

export function printerSettingsStorageKey(printerId: string): string {
  return isDashboardSynced()
    ? 'mpu:v2:settings:GLOBAL'
    : `mpu:v2:settings:${printerId}`;
}

export function pluginSettingsStorageKey(
  printerId: string,
  pluginId: string,
): string {
  return isPluginSynced(pluginId)
    ? `mpu:v2:plugin-settings:GLOBAL:${pluginId}`
    : `mpu:v2:plugin-settings:${printerId}:${pluginId}`;
}

const DEFAULT_UI_STATE: UiState = {
  theme: 'dark',
  locale: 'en',
  dir: 'ltr',
  sidebarCollapsed: false,
  sidebarWidth: 280,
  rightPanelCollapsed: false,
  rightPanelWidth: 320,
  bgImage: null,
  accent: null,
  logoAnimated: true,
  fleetOpen: false,
  fleetPanels: [],
  fleetPanelsCustomized: false,
  hotkeyOverrides: {},
  extensionResolutions: {},
  notifications: { ignoredPatterns: [], soundEnabled: false },
  updateCheck: { intervalHours: 4, lastCheckedAt: 0, notified: {} },
};

const LEGACY_UNPREFIXED_KEYS = new Set<string>([
  'printers',
  'activePrinter',
  'plugins',
  'ui',
  'settings',
  'plugin-settings',
]);

export const RIGHT_PANEL_MIN_WIDTH = 240;
export const RIGHT_PANEL_MAX_WIDTH = 560;
export const RIGHT_PANEL_DEFAULT_WIDTH = 320;

/** Интервал проверки обновлений, часы: по умолчанию 4, не чаще раза в час (не нагружаем GitHub). */
export const UPDATE_CHECK_DEFAULT_HOURS = 4;
export const UPDATE_CHECK_MIN_HOURS = 1;
export const UPDATE_CHECK_MAX_HOURS = 168;

/** Целое число часов в допустимых границах; мусор из хранилища → значение по умолчанию. */
export function normalizeUpdateCheckHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UPDATE_CHECK_DEFAULT_HOURS;
  return clamp(Math.round(value), UPDATE_CHECK_MIN_HOURS, UPDATE_CHECK_MAX_HOURS);
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore(options: SettingsStoreOptions = {}) {
  const storage = options.storage ?? getDefaultStorage();

  const initialPrinters = readPrinters(storage);
  const storedActivePrinterId = readActivePrinterId(storage);

  const initialActivePrinterId = initialPrinters.some(
    (printer) => printer.id === storedActivePrinterId,
  )
    ? storedActivePrinterId
    : (initialPrinters[0]?.id ?? null);

  let printers = $state<PrinterRecord[]>(initialPrinters);
  let activePrinterId = $state<string | null>(initialActivePrinterId);
  let plugins = $state<RemotePluginRecord[]>(readPlugins(storage));
  let ui = $state<UiState>(readUiState(storage));
  let legacy = $state<LegacySchemaInfo>(
    createLegacyInfo(detectLegacyKeys(storage)),
  );

  /**
   * Local reactive caches for per-printer settings.
   */
  let printerSettingsCache = $state<Record<string, PrinterSettingsState>>({});
  let pluginSettingsCache = $state<Record<string, PluginSettingsState>>({});
  for (const printer of initialPrinters) {
    warmPrinterSettings(printer.id);
  }

  // Одноразовая миграция: у пользователей, которые уже настраивали раскладки
  // (dashboardLayout.length > 0 или quickChips.length > 0) до появления флага
  // customized, ставим customized = true, чтобы их выбор сохранился.
  for (const printer of printers) {
    const s = printerSettingsCache[printer.id];
    if (!s) continue;
    const needsDashboardFlag = s.dashboardLayout.length > 0 && !s.dashboardLayoutCustomized;
    const needsChipsFlag = s.quickChips.length > 0 && !s.quickChipsCustomized;
    if (needsDashboardFlag || needsChipsFlag) {
      updatePrinterSettings(printer.id, (draft) => {
        if (needsDashboardFlag) draft.dashboardLayoutCustomized = true;
        if (needsChipsFlag) draft.quickChipsCustomized = true;
      });
    }
  }

  const pluginSettingsPairs = new Map<string, { printerId: string; pluginId: string }>();

  const pluginSettingsListeners = new Map<
    string,
    Set<(settings: PluginSettingsState) => void>
  >();
  const printerSettingsPairs = new Set<string>();

  onSyncChange(() => {
    // namespace сменился — сбрасываем кэши
    pluginSettingsCache = {};
    printerSettingsCache = {};

    // уведомляем подписчиков плагинов
    for (const [cacheKey, pair] of pluginSettingsPairs) {
      notifyPluginSettingsChange(
        cacheKey,
        readPluginSettings(storage, pair.printerId, pair.pluginId),
      );
    }

    // форсируем реактивное обновление printer settings
    for (const pid of printerSettingsPairs) {
      warmPrinterSettings(pid);
    }
  });

  /**
   * Persist corrected active printer id if needed.
   */
  if (initialActivePrinterId !== storedActivePrinterId) {
    persistActivePrinter();
  }

  const shouldBootstrap =
    options.createDefaultPrinter ??
    (options.storage === undefined && typeof window !== 'undefined');

  if (printers.length === 0 && shouldBootstrap) {
    const defaultPrinter: PrinterRecord = {
      id: createId(),
      name: 'MyPrinter',
      url: (() => {
        if (typeof window === 'undefined') {
          return 'http://localhost:7125';
        }
        try {
          const u = new URL(window.location.origin);
          u.port = '7125';
          return u.origin;
        } catch {
          return window.location.origin;
        }
      })(),
    };
    printers = [defaultPrinter];
    warmPrinterSettings(defaultPrinter.id);
    activePrinterId = defaultPrinter.id;
    persistPrinters();
    persistActivePrinter();
  }

  // ------------------------------------------------------------------
  // Printers
  // ------------------------------------------------------------------

  function addPrinter(input: { name: string; url: string }): PrinterRecord {
    const record: PrinterRecord = {
      id: createId(),
      name: input.name.trim() || 'Printer',
      url: normalizeUrl(input.url),
    };

    printers = [...printers, record];
    warmPrinterSettings(record.id);

    if (!activePrinterId) {
      activePrinterId = record.id;
      persistActivePrinter();
    }

    persistPrinters();

    return record;
  }

  function updatePrinter(
    id: string,
    patch: { name?: string; url?: string },
  ): void {
    printers = printers.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        name: patch.name !== undefined ? patch.name : p.name,
        url: patch.url !== undefined ? normalizeUrl(patch.url) : p.url,
      };
    });

    persistPrinters();
  }

  function removePrinter(id: string): void {
    printers = printers.filter((printer) => printer.id !== id);

    removePrinterData(id);

    if (activePrinterId === id) {
      setActivePrinter(printers[0]?.id ?? null);
    }

    persistPrinters();
  }

  function setActivePrinter(id: string | null): void {
    if (id === null) {
      activePrinterId = null;
      persistActivePrinter();
      return;
    }

    const exists = printers.some((printer) => printer.id === id);

    if (!exists) {
      return;
    }

    activePrinterId = id;
    persistActivePrinter();
  }

  function persistPrinters(): void {
    writeJson(storage, SETTINGS_STORAGE_KEYS.printers, printers);
  }

  function persistActivePrinter(): void {
    try {
      if (activePrinterId) {
        storage.setItem(SETTINGS_STORAGE_KEYS.activePrinter, activePrinterId);
      } else {
        storage.removeItem(SETTINGS_STORAGE_KEYS.activePrinter);
      }
    } catch {
      // Ignore storage errors.
    }
  }

  function removePrinterData(printerId: string): void {
    removeItem(storage, printerSettingsStorageKey(printerId));

    const pluginPrefix = `mpu:v2:plugin-settings:${printerId}:`;
    const keysToRemove: string[] = [];

    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);

      if (key && key.startsWith(pluginPrefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      removeItem(storage, key);
    }

    const nextPrinterSettingsCache = { ...printerSettingsCache };
    delete nextPrinterSettingsCache[printerId];
    printerSettingsCache = nextPrinterSettingsCache;

    const nextPluginSettingsCache: Record<string, PluginSettingsState> = {};

    for (const [cacheKey, value] of Object.entries(pluginSettingsCache)) {
      if (!cacheKey.startsWith(`${printerId}:`)) {
        nextPluginSettingsCache[cacheKey] = value;
      }
    }

    pluginSettingsCache = nextPluginSettingsCache;
  }

  // ------------------------------------------------------------------
  // Remote plugins
  // ------------------------------------------------------------------

  function addPlugin(
    manifestUrl: string,
    printerIds: string[] = [],
    source: 'catalog' | 'url' = 'url',
    installedVersion?: string,
  ): RemotePluginRecord {
    const normalized = manifestUrl.trim();

    const existing = plugins.find(
      (plugin) => plugin.manifestUrl === normalized,
    );

    if (existing) {
      // обновление версии при reinstall
      if (installedVersion && existing.installedVersion !== installedVersion) {
        plugins = plugins.map((p) =>
          p.manifestUrl === normalized ? { ...p, installedVersion } : p,
        );
        persistPlugins();
        return plugins.find((p) => p.manifestUrl === normalized)!;
      }
      return existing;
    }

    const record: RemotePluginRecord = {
      manifestUrl: normalized,
      enabled: true,
      printerIds,
      source,
      installedVersion,
    };

    plugins = [...plugins, record];
    persistPlugins();

    return record;
  }

  function setPluginEnabled(manifestUrl: string, enabled: boolean): void {
    plugins = plugins.map((plugin) => {
      if (plugin.manifestUrl !== manifestUrl) {
        return plugin;
      }

      return {
        ...plugin,
        enabled,
      };
    });

    persistPlugins();
  }

  function setPluginPrinters(manifestUrl: string, printerIds: string[]): void {
    plugins = plugins.map((plugin) => {
      if (plugin.manifestUrl !== manifestUrl) {
        return plugin;
      }

      return {
        ...plugin,
        printerIds,
      };
    });

    persistPlugins();
  }

  function removePlugin(manifestUrl: string): void {
    plugins = plugins.filter(
      (plugin) => plugin.manifestUrl !== manifestUrl,
    );

    persistPlugins();
  }

  function persistPlugins(): void {
    writeJson(storage, SETTINGS_STORAGE_KEYS.plugins, plugins);
  }

  // ------------------------------------------------------------------
  // UI state
  // ------------------------------------------------------------------

  function patchUi(patch: Partial<UiState>): void {
    ui = {
      ...ui,
      ...patch,
    };

    writeJson(storage, SETTINGS_STORAGE_KEYS.ui, ui);
  }

  function setTheme(theme: ThemeMode): void {
    patchUi({ theme });
  }

  function setLocale(locale: string, dir?: LocaleDirection): void {
    if (dir) {
      patchUi({ locale, dir });
      return;
    }

    patchUi({ locale });
  }

  function setDir(dir: LocaleDirection): void {
    patchUi({ dir });
  }

  function toggleSidebar(collapsed?: boolean): void {
    patchUi({
      sidebarCollapsed: collapsed ?? !ui.sidebarCollapsed,
    });
  }

  function setSidebarWidth(width: number): void {
    if (!Number.isFinite(width) || width < 0) {
      return;
    }

    patchUi({ sidebarWidth: width });
  }

  function toggleRightPanel(collapsed?: boolean): void {
    patchUi({
      rightPanelCollapsed: collapsed ?? !ui.rightPanelCollapsed,
    });
  }

  function setRightPanelWidth(width: number): void {
    if (!Number.isFinite(width)) {
      return;
    }

    patchUi({
      rightPanelWidth: clamp(
        width,
        RIGHT_PANEL_MIN_WIDTH,
        RIGHT_PANEL_MAX_WIDTH,
      ),
    });
  }

  function setLogoAnimated(logoAnimated: boolean): void {
    patchUi({ logoAnimated });
  }

  function setBackgroundImage(bgImage: string | null): boolean {
    if (
      bgImage !== null &&
      (!bgImage.startsWith('data:image/') || bgImage.length > BG_IMAGE_MAX_CHARS)
    ) {
      return false;   // UI покажет ошибку размера/формата
    }
    patchUi({ bgImage });
    return true;
  }

  function setAccent(accent: string | null): boolean {
    if (accent !== null && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
      return false;  // UI покажет ошибку формата
    }
    patchUi({ accent: accent === null ? null : accent.toLowerCase() });
    return true;
  }

  // ------------------------------------------------------------------
  // Per-printer settings
  // ------------------------------------------------------------------

  function ensurePrinterSettings(printerId: string): PrinterSettingsState {
    const cached = printerSettingsCache[printerId];

    if (cached) {
      return cached;
    }

    printerSettingsPairs.add(printerId);
    return readPrinterSettings(storage, printerId);
  }

  function warmPrinterSettings(printerId: string): void {
    if (printerSettingsCache[printerId]) {
      return;
    }

    printerSettingsCache = {
      ...printerSettingsCache,
      [printerId]: readPrinterSettings(storage, printerId),
    };
  }

  function getPrinterSettings(printerId: string): PrinterSettingsState {
    return ensurePrinterSettings(printerId);
  }

  function updatePrinterSettings(
    printerId: string,
    updater: (draft: PrinterSettingsState) => PrinterSettingsState | void,
  ): void {
    const current = ensurePrinterSettings(printerId);
    const draft = clonePrinterSettings(current);

    const result = updater(draft) ?? draft;
    const next = normalizePrinterSettings(result);

    printerSettingsCache = {
      ...printerSettingsCache,
      [printerId]: next,
    };

    writeJson(storage, printerSettingsStorageKey(printerId), next);
  }

  function getPageVisibility(printerId: string, pageId: string): boolean {
    const settings = ensurePrinterSettings(printerId);
    return settings.pages[pageId] ?? true;
  }

  function setPageVisibility(
    printerId: string,
    pageId: string,
    visible: boolean,
  ): void {
    updatePrinterSettings(printerId, (draft) => {
      draft.pages[pageId] = visible;
    });
  }

  function getWidgetProvider(
    printerId: string,
    widgetType: string,
  ): string | undefined {
    const settings = ensurePrinterSettings(printerId);
    return settings.widgetProviders[widgetType];
  }

  function setWidgetProvider(
    printerId: string,
    widgetType: string,
    providerId: string | null | undefined,
  ): void {
    updatePrinterSettings(printerId, (draft) => {
      if (!providerId) {
        delete draft.widgetProviders[widgetType];
        return;
      }

      draft.widgetProviders[widgetType] = providerId;
    });
  }

  function clearWidgetProvider(printerId: string, widgetType: string): void {
    setWidgetProvider(printerId, widgetType, null);
  }

  function getDashboardLayout(
    printerId: string,
  ): DashboardWidgetLayoutItem[] {
    const settings = ensurePrinterSettings(printerId);
    return settings.dashboardLayout;
  }

  function setDashboardLayout(
    printerId: string,
    layout: DashboardWidgetLayoutItem[],
  ): void {
    updatePrinterSettings(printerId, (draft) => {
      draft.dashboardLayout = normalizeDashboardLayout(layout);
      draft.dashboardLayoutCustomized = true;
    });
  }

  function resetDashboardLayout(printerId: string): void {
    updatePrinterSettings(printerId, (draft) => {
      draft.dashboardLayout = [];
      draft.dashboardLayoutCustomized = false;
    });
  }

  /** Возвращает макет и чипы принтера к сохранённому состоянию (отмена правок), флаги включительно. */
  function restoreEditState(
    printerId: string,
    state: {
      dashboardLayout: DashboardWidgetLayoutItem[];
      dashboardLayoutCustomized: boolean;
      quickChips: QuickChipLayoutItem[];
      quickChipsCustomized: boolean;
    },
  ): void {
    updatePrinterSettings(printerId, (draft) => {
      draft.dashboardLayout = state.dashboardLayout;
      draft.dashboardLayoutCustomized = state.dashboardLayoutCustomized;
      draft.quickChips = state.quickChips;
      draft.quickChipsCustomized = state.quickChipsCustomized;
    });
  }

  function getQuickChips(printerId: string): QuickChipLayoutItem[] {
    return ensurePrinterSettings(printerId).quickChips;
  }

  function setQuickChips(
    printerId: string,
    chips: QuickChipLayoutItem[],
  ): void {
    updatePrinterSettings(printerId, (draft) => {
      draft.quickChips = chips;
      draft.quickChipsCustomized = true;
    });
  }

  function resetQuickChips(printerId: string): void {
    updatePrinterSettings(printerId, (draft) => {
      draft.quickChips = [];
      draft.quickChipsCustomized = false;
    });
  }

  // ------------------------------------------------------------------
  // Fleet panels layout (device-global)
  // ------------------------------------------------------------------

  function getFleetPanels(): FleetPanelLayoutItem[] {
    return ui.fleetPanels;
  }

  function setFleetPanels(layout: FleetPanelLayoutItem[]): void {
    patchUi({ fleetPanels: layout, fleetPanelsCustomized: true });
  }

  function resetFleetPanels(): void {
    patchUi({ fleetPanels: [], fleetPanelsCustomized: false });
  }

  // ------------------------------------------------------------------
  // Hotkey overrides (device-global)
  // ------------------------------------------------------------------

  function getHotkeyOverrides(): Record<string, string | null> {
    return ui.hotkeyOverrides;
  }

  /** keys — новая комбинация, null — отключить клавишу. */
  function setHotkeyOverride(key: string, keys: string | null): void {
    patchUi({ hotkeyOverrides: { ...ui.hotkeyOverrides, [key]: keys } });
  }

  /** Вернуть значение по умолчанию для одной клавиши. */
  function clearHotkeyOverride(key: string): void {
    const { [key]: _removed, ...rest } = ui.hotkeyOverrides;
    patchUi({ hotkeyOverrides: rest });
  }

  function resetHotkeyOverrides(): void {
    patchUi({ hotkeyOverrides: {} });
  }

  // ------------------------------------------------------------------
  // Extension points: решения конфликтов (device-global), выбор варианта (per-printer)
  // ------------------------------------------------------------------

  function setNotificationSettings(patch: Partial<UiState['notifications']>): void {
    patchUi({ notifications: { ...ui.notifications, ...patch } });
  }

  function setUpdateCheckSettings(patch: Partial<UiState['updateCheck']>): void {
    const next = { ...ui.updateCheck, ...patch };
    // Интервал нормализуем здесь, а не в UI: нижняя граница — защита от частых запросов.
    next.intervalHours = normalizeUpdateCheckHours(next.intervalHours);
    patchUi({ updateCheck: next });
  }

  function setExtensionResolution(
    address: string,
    resolution: { winners: string[]; candidates: string[] } | null,
  ): void {
    const { [address]: _removed, ...rest } = ui.extensionResolutions;
    patchUi({ extensionResolutions: resolution ? { ...rest, [address]: resolution } : rest });
  }

  function getExtensionChoice(printerId: string, address: string): string | null | undefined {
    return ensurePrinterSettings(printerId).extensionChoices[address];
  }

  /** undefined — сбросить выбор (вернуть default точки). */
  function setExtensionChoice(printerId: string, address: string, ref: string | null | undefined): void {
    updatePrinterSettings(printerId, (draft) => {
      if (ref === undefined) delete draft.extensionChoices[address];
      else draft.extensionChoices[address] = ref;
    });
  }

  // ------------------------------------------------------------------
  // Plugin settings
  // ------------------------------------------------------------------

  function pluginSettingsCacheKey(printerId: string, pluginId: string): string {
    return isPluginSynced(pluginId)
      ? `GLOBAL:${pluginId}`        // sync ON: один кэш на все принтеры
      : `${printerId}:${pluginId}`; // sync OFF: per-printer
  }

  function ensurePluginSettings(
    printerId: string,
    pluginId: string,
  ): PluginSettingsState {
    const cacheKey = pluginSettingsCacheKey(printerId, pluginId);

    const cached = pluginSettingsCache[cacheKey];

    if (cached) {
      return cached;
    }

    return readPluginSettings(storage, printerId, pluginId);
  }

  function getPluginSettings(
    printerId: string,
    pluginId: string,
  ): PluginSettingsState {
    return ensurePluginSettings(printerId, pluginId);
  }

  function getPluginSetting<T = unknown>(
    printerId: string,
    pluginId: string,
    key: string,
  ): T | undefined {
    const settings = ensurePluginSettings(printerId, pluginId);
    return settings[key] as T | undefined;
  }

  function patchPluginSettings(
    printerId: string,
    pluginId: string,
    patch: PluginSettingsState,
  ): void {
    const cacheKey = pluginSettingsCacheKey(printerId, pluginId);
    const current = ensurePluginSettings(printerId, pluginId);

    const next: PluginSettingsState = {
      ...current,
      ...patch,
    };

    pluginSettingsCache = {
      ...pluginSettingsCache,
      [cacheKey]: next,
    };

    writeJson(
      storage,
      pluginSettingsStorageKey(printerId, pluginId),
      next,
    );

    notifyPluginSettingsChange(cacheKey, next);
  }

  function setPluginSetting(
    printerId: string,
    pluginId: string,
    key: string,
    value: unknown,
  ): void {
    patchPluginSettings(printerId, pluginId, {
      [key]: value,
    });
  }

  function applyPluginDefaults(
    printerId: string,
    pluginId: string,
    defaults: PluginSettingsState,
  ): void {
    if (!defaults || typeof defaults !== 'object') {
      return;
    }

    const cacheKey = pluginSettingsCacheKey(printerId, pluginId);
    const current = ensurePluginSettings(printerId, pluginId);

    let changed = false;

    const next: PluginSettingsState = {
      ...current,
    };

    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in current)) {
        next[key] = value;
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    pluginSettingsCache = {
      ...pluginSettingsCache,
      [cacheKey]: next,
    };

    writeJson(
      storage,
      pluginSettingsStorageKey(printerId, pluginId),
      next,
    );

    notifyPluginSettingsChange(cacheKey, next);
  }

  function clearPluginSettings(printerId: string, pluginId: string): void {
    const cacheKey = pluginSettingsCacheKey(printerId, pluginId);
    const next: PluginSettingsState = {};

    pluginSettingsCache = {
      ...pluginSettingsCache,
      [cacheKey]: next,
    };

    writeJson(
      storage,
      pluginSettingsStorageKey(printerId, pluginId),
      next,
    );

    notifyPluginSettingsChange(cacheKey, next);
  }

  function onPluginSettingsChange(
    printerId: string,
    pluginId: string,
    callback: (settings: PluginSettingsState) => void,
  ): () => void {
    const cacheKey = pluginSettingsCacheKey(printerId, pluginId);
    pluginSettingsPairs.set(cacheKey, { printerId, pluginId });

    let listeners = pluginSettingsListeners.get(cacheKey);

    if (!listeners) {
      listeners = new Set();
      pluginSettingsListeners.set(cacheKey, listeners);
    }

    listeners.add(callback);

    return () => {
      if (!listeners) {
        return;
      }

      listeners.delete(callback);

      if (listeners.size === 0) {
        pluginSettingsListeners.delete(cacheKey);
      }
    };
  }

  function notifyPluginSettingsChange(
    cacheKey: string,
    settings: PluginSettingsState,
  ): void {
    const listeners = pluginSettingsListeners.get(cacheKey);

    if (!listeners) {
      return;
    }

    for (const listener of Array.from(listeners)) {
      safeCall(listener, settings);
    }
  }

  // ------------------------------------------------------------------
  // Legacy schema detection
  // ------------------------------------------------------------------

  function getLegacyExportData(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const key of legacy.keys) {
      try {
        const raw = storage.getItem(key);

        if (raw === null) {
          continue;
        }

        try {
          result[key] = JSON.parse(raw);
        } catch {
          result[key] = raw;
        }
      } catch {
        // Ignore unreadable legacy keys.
      }
    }

    return result;
  }

  function clearLegacyKeys(): void {
    for (const key of legacy.keys) {
      removeItem(storage, key);
    }

    legacy = {
      detected: false,
      keys: [],
    };
  }

  // ------------------------------------------------------------------
  // Store API
  // ------------------------------------------------------------------

  return {
    get printers(): PrinterRecord[] {
      return printers;
    },

    get activePrinterId(): string | null {
      return activePrinterId;
    },

    get activePrinter(): PrinterRecord | null {
      return printers.find((printer) => printer.id === activePrinterId) ?? null;
    },

    get plugins(): RemotePluginRecord[] {
      return plugins;
    },

    get ui(): UiState {
      return ui;
    },

    get legacy(): LegacySchemaInfo {
      return legacy;
    },

    getPluginSync: (pluginId: string) => isPluginSynced(pluginId),
    setPluginSync: (pluginId: string, on: boolean) =>
    setPluginSynced(activePrinterId ?? '', pluginId, on),

    getDashboardSync: () => isDashboardSynced(),
    setDashboardSync: (on: boolean) =>
    setDashboardSynced(activePrinterId ?? '', on),

    addPrinter,
    updatePrinter,
    removePrinter,
    setActivePrinter,

    addPlugin,
    setPluginEnabled,
    setPluginPrinters,
    removePlugin,

    patchUi,
    setTheme,
    setLocale,
    setDir,
    toggleSidebar,
    setSidebarWidth,
    toggleRightPanel,
    setRightPanelWidth,
    setBackgroundImage,
    setAccent,
    setLogoAnimated,

    getPrinterSettings,
    getPageVisibility,
    setPageVisibility,

    getWidgetProvider,
    setWidgetProvider,
    clearWidgetProvider,

    getDashboardLayout,
    setDashboardLayout,
    resetDashboardLayout,
    restoreEditState,

    getQuickChips,
    setQuickChips,
    resetQuickChips,

    getFleetPanels,
    setFleetPanels,
    resetFleetPanels,
    getHotkeyOverrides,
    setHotkeyOverride,
    clearHotkeyOverride,
    resetHotkeyOverrides,
    setNotificationSettings,
    setUpdateCheckSettings,
    setExtensionResolution,
    getExtensionChoice,
    setExtensionChoice,

    getPluginSettings,
    getPluginSetting,
    setPluginSetting,
    patchPluginSettings,
    applyPluginDefaults,
    clearPluginSettings,
    onPluginSettingsChange,

    getLegacyExportData,
    clearLegacyKeys,
  };
}

// --------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------

function getDefaultStorage(): StorageLike {
  const global = globalThis as {
    localStorage?: StorageLike;
  };

  if (global.localStorage) {
    return global.localStorage;
  }

  return new MemoryStorage();
}

function createId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  return `id-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readActivePrinterId(storage: StorageLike): string | null {
  try {
    return storage.getItem(SETTINGS_STORAGE_KEYS.activePrinter);
  } catch {
    return null;
  }
}

function readPrinters(storage: StorageLike): PrinterRecord[] {
  const value = readJson<unknown>(
    storage,
    SETTINGS_STORAGE_KEYS.printers,
    [],
  );

  return normalizePrinterList(value);
}

function normalizePrinterList(value: unknown): PrinterRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: PrinterRecord[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    if (
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.url === 'string'
    ) {
      result.push({
        id: item.id,
        name: item.name,
        url: item.url,
      });
    }
  }

  return result;
}

function readPlugins(storage: StorageLike): RemotePluginRecord[] {
  const value = readJson<unknown>(
    storage,
    SETTINGS_STORAGE_KEYS.plugins,
    [],
  );

  return normalizePluginList(value);
}

function normalizePluginList(value: unknown): RemotePluginRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: RemotePluginRecord[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    if (typeof item.manifestUrl !== 'string') {
      continue;
    }

    result.push({
      manifestUrl: item.manifestUrl,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      printerIds: Array.isArray(item.printerIds)
        ? item.printerIds.filter((id): id is string => typeof id === 'string')
        : [],
      source: item.source === 'catalog' || item.source === 'url' ? item.source : 'url',
      installedVersion: typeof item.installedVersion === 'string' ? item.installedVersion : undefined,
    });
  }

  return result;
}

function readUiState(storage: StorageLike): UiState {
  const value = readJson<unknown>(storage, SETTINGS_STORAGE_KEYS.ui, {});
  return normalizeUiState(value);
}

function normalizeUiState(value: unknown): UiState {
  const source = isRecord(value) ? value : {};

  const theme: ThemeMode = source.theme === 'dark' ? 'dark' : 'light';

  const dir: LocaleDirection = source.dir === 'rtl' ? 'rtl' : 'ltr';

  const locale =
    typeof source.locale === 'string' && source.locale.length > 0
      ? source.locale
      : DEFAULT_UI_STATE.locale;

  const sidebarCollapsed =
    typeof source.sidebarCollapsed === 'boolean'
      ? source.sidebarCollapsed
      : DEFAULT_UI_STATE.sidebarCollapsed;

  const sidebarWidth = isFiniteNumber(source.sidebarWidth)
    ? source.sidebarWidth
    : DEFAULT_UI_STATE.sidebarWidth;

  const rightPanelCollapsed =
    typeof source.rightPanelCollapsed === 'boolean'
      ? source.rightPanelCollapsed
      : DEFAULT_UI_STATE.rightPanelCollapsed;

  const rawRightPanelWidth = isFiniteNumber(source.rightPanelWidth)
    ? source.rightPanelWidth
    : DEFAULT_UI_STATE.rightPanelWidth;

  const rightPanelWidth = clamp(
    rawRightPanelWidth,
    RIGHT_PANEL_MIN_WIDTH,
    RIGHT_PANEL_MAX_WIDTH,
  );

  const bgImage =
  typeof source.bgImage === 'string' && source.bgImage.startsWith('data:image/')
    ? source.bgImage
    : null;

  const accent =
  typeof source.accent === 'string' && /^#([0-9a-fA-F]{6})$/.test(source.accent)
    ? source.accent.toLowerCase()
    : null;

  const logoAnimated =
    typeof source.logoAnimated === 'boolean'
      ? source.logoAnimated
      : DEFAULT_UI_STATE.logoAnimated;

  const fleetOpen =
    typeof source.fleetOpen === 'boolean'
      ? source.fleetOpen
      : DEFAULT_UI_STATE.fleetOpen;

  const fleetPanels: FleetPanelLayoutItem[] = [];
  if (Array.isArray(source.fleetPanels)) {
    for (const item of source.fleetPanels) {
      if (
        isRecord(item) &&
        typeof item.pluginId === 'string' &&
        typeof item.contributionId === 'string'
      ) {
        fleetPanels.push({
          pluginId: item.pluginId,
          contributionId: item.contributionId,
          visible: typeof item.visible === 'boolean' ? item.visible : true,
        });
      }
    }
  }

  const fleetPanelsCustomized =
    typeof source.fleetPanelsCustomized === 'boolean'
      ? source.fleetPanelsCustomized
      : false;

  const hotkeyOverrides: Record<string, string | null> = {};
  if (isRecord(source.hotkeyOverrides)) {
    for (const [key, value] of Object.entries(source.hotkeyOverrides)) {
      if (value === null || typeof value === 'string') hotkeyOverrides[key] = value;
    }
  }

  const extensionResolutions: UiState['extensionResolutions'] = {};
  if (isRecord(source.extensionResolutions)) {
    for (const [address, value] of Object.entries(source.extensionResolutions)) {
      if (isRecord(value) && isStringArray(value.winners) && isStringArray(value.candidates)) {
        extensionResolutions[address] = { winners: [...value.winners], candidates: [...value.candidates] };
      }
    }
  }

  const notificationsSource = isRecord(source.notifications) ? source.notifications : {};
  const notifications: UiState['notifications'] = {
    ignoredPatterns: isStringArray(notificationsSource.ignoredPatterns)
      ? [...notificationsSource.ignoredPatterns]
      : [],
    soundEnabled:
      typeof notificationsSource.soundEnabled === 'boolean'
        ? notificationsSource.soundEnabled
        : DEFAULT_UI_STATE.notifications.soundEnabled,
  };

  const updateCheckSource = isRecord(source.updateCheck) ? source.updateCheck : {};
  const notified: Record<string, string> = {};
  if (isRecord(updateCheckSource.notified)) {
    for (const [key, value] of Object.entries(updateCheckSource.notified)) {
      if (typeof value === 'string') notified[key] = value;
    }
  }
  const updateCheck: UiState['updateCheck'] = {
    intervalHours: normalizeUpdateCheckHours(updateCheckSource.intervalHours),
    lastCheckedAt:
      typeof updateCheckSource.lastCheckedAt === 'number' &&
      Number.isFinite(updateCheckSource.lastCheckedAt) &&
      updateCheckSource.lastCheckedAt > 0
        ? updateCheckSource.lastCheckedAt
        : 0,
    notified,
  };

  return {
    theme,
    locale,
    dir,
    sidebarCollapsed,
    sidebarWidth,
    rightPanelCollapsed,
    rightPanelWidth,
    bgImage: bgImage && bgImage.length <= BG_IMAGE_MAX_CHARS ? bgImage : null,
    accent,
    logoAnimated,
    fleetOpen,
    fleetPanels,
    fleetPanelsCustomized,
    hotkeyOverrides,
    extensionResolutions,
    notifications,
    updateCheck,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPrinterSettings(
  storage: StorageLike,
  printerId: string,
): PrinterSettingsState {
  const value = readJson<unknown>(
    storage,
    printerSettingsStorageKey(printerId),
    {},
  );

  return normalizePrinterSettings(value);
}

function normalizePrinterSettings(value: unknown): PrinterSettingsState {
  const source = isRecord(value) ? value : {};

  const pages: Record<string, boolean> = {};

  if (isRecord(source.pages)) {
    for (const [pageId, visible] of Object.entries(source.pages)) {
      if (typeof visible === 'boolean') {
        pages[pageId] = visible;
      }
    }
  }

  const widgetProviders: Record<string, string> = {};

  if (isRecord(source.widgetProviders)) {
    for (const [widgetType, providerId] of Object.entries(
      source.widgetProviders,
    )) {
      if (typeof providerId === 'string') {
        widgetProviders[widgetType] = providerId;
      }
    }
  }

  const quickChips: QuickChipLayoutItem[] = [];
  if (Array.isArray(source.quickChips)) {
    for (const item of source.quickChips) {
      if (
        isRecord(item) &&
        typeof item.instanceId === 'string' &&
        typeof item.type === 'string' &&
        typeof item.provider === 'string' &&
        typeof item.id === 'string'
      ) {
        quickChips.push({
          instanceId: item.instanceId,
          type: item.type,
          provider: item.provider,
          id: item.id,
          label: typeof item.label === 'string' ? item.label : undefined,
        });
      }
    }
  }

  const extensionChoices: Record<string, string | null> = {};
  if (isRecord(source.extensionChoices)) {
    for (const [address, ref] of Object.entries(source.extensionChoices)) {
      if (ref === null || typeof ref === 'string') extensionChoices[address] = ref;
    }
  }

  return {
    pages,
    widgetProviders,
    extensionChoices,
    dashboardLayout: normalizeDashboardLayout(source.dashboardLayout),
    dashboardLayoutCustomized:
      typeof source.dashboardLayoutCustomized === 'boolean'
        ? source.dashboardLayoutCustomized
        : false,
    quickChips,
    quickChipsCustomized:
      typeof source.quickChipsCustomized === 'boolean'
        ? source.quickChipsCustomized
        : false,
  };
}

function normalizeDashboardLayout(value: unknown): DashboardWidgetLayoutItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: DashboardWidgetLayoutItem[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    if (
      typeof item.instanceId !== 'string' ||
      typeof item.type !== 'string' ||
      typeof item.provider !== 'string' ||
      !isFiniteNumber(item.x) ||
      !isFiniteNumber(item.y) ||
      !isFiniteNumber(item.w) ||
      !isFiniteNumber(item.h)
    ) {
      continue;
    }

    result.push({
      instanceId: item.instanceId,
      type: item.type,
      provider: item.provider,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    });
  }

  return result;
}

function clonePrinterSettings(
  source: PrinterSettingsState,
): PrinterSettingsState {
  return {
    pages: { ...source.pages },
    widgetProviders: { ...source.widgetProviders },
    extensionChoices: { ...source.extensionChoices },
    dashboardLayout: source.dashboardLayout.map((item) => ({ ...item })),
    dashboardLayoutCustomized: source.dashboardLayoutCustomized,
    quickChips: source.quickChips.map((item) => ({ ...item })),
    quickChipsCustomized: source.quickChipsCustomized,
  };
}

function readPluginSettings(
  storage: StorageLike,
  printerId: string,
  pluginId: string,
): PluginSettingsState {
  const value = readJson<unknown>(
    storage,
    pluginSettingsStorageKey(printerId, pluginId),
    {},
  );

  return normalizePluginSettings(value);
}

function normalizePluginSettings(value: unknown): PluginSettingsState {
  if (!isRecord(value)) {
    return {};
  }

  const result: PluginSettingsState = {};

  for (const [key, item] of Object.entries(value)) {
    result[key] = item;
  }

  return result;
}

function detectLegacyKeys(storage: StorageLike): string[] {
  const keys: string[] = [];

  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);

    if (!key) {
      continue;
    }

    if (isLegacyKey(key)) {
      keys.push(key);
    }
  }

  return keys.sort();
}

function isLegacyKey(key: string): boolean {
  if (key.startsWith('mpu:v1:')) {
    return true;
  }

  if (key.startsWith('mpu:v2:')) {
    return false;
  }

  if (key.startsWith('mpu:')) {
    return true;
  }

  if (LEGACY_UNPREFIXED_KEYS.has(key)) {
    return true;
  }

  if (key.startsWith('settings:') || key.startsWith('plugin-settings:')) {
    return true;
  }

  return false;
}

function createLegacyInfo(keys: string[]): LegacySchemaInfo {
  return {
    detected: keys.length > 0,
    keys,
  };
}

function safeCall<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): void {
  try {
    fn(...args);
  } catch (error) {
    console.error('[settings-store] listener error', error);
  }
}