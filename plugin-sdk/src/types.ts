/**
 * Modular Printer UI v2
 * Public plugin contracts.
 *
 * Source of truth: CONTEXT.md
 *
 * Important:
 * - No plugin-to-plugin bus
 * - No shared state
 *   (the only plugin → host channel is the opaque fleet index, api.fleet:
 *   the host stores tags/searchText for fleet search and filters and never
 *   interprets them)
 * - No permissions
 * - No capabilities/priority
 * - Widgets are described only by type + provider
 */

export type ThemeMode = 'light' | 'dark';
export type LocaleDirection = 'ltr' | 'rtl';
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/**
 * Printer descriptor as exposed to plugins.
 */
export interface PrinterInfo {
  id: string;
  name: string;
  url: string;
}

/**
 * Grid size descriptor for widgets.
 */
export interface WidgetSize {
  w: number;
  h: number;
}

/**
 * Строковые параметры, которые хост передаёт Custom Element'у поверхности
 * (свойство `params`; дублируются в `dataset`).
 */
export type MpuParams = Record<string, string>;

/**
 * Базовый контракт любого вклада-поверхности: Custom Element по тегу.
 * Все поверхности (pages/widgets/overlays/banners/chips/printerPanels/rightPanel)
 * рендерятся одинаково: хост создаёт элемент и инжектит свойства
 * `api` (PluginApi) и `params` (MpuParams).
 */
export interface ElementContribution {
  /** CE-тег (для legacy-вкладов может быть заполнен загрузчиком из component). */
  element?: string;
}

/** Вклад с идентификатором внутри плагина и обязательным CE-тегом. */
export interface SurfaceContribution {
  id: string;
  element: string;
}

/**
 * Page contributed by a plugin.
 */
export interface PageContribution extends ElementContribution {
  id: string;
  titleKey: string;
  icon?: string;
  iconSvg?: string;
  /** @deprecated Svelte-экспорт модуля; загрузчик оборачивает его в CE и заполняет element. */
  component?: string;
}

/**
 * Widget contributed by a plugin.
 *
 * Single widget model:
 * - type identifies widget kind
 * - provider identifies concrete implementation
 */
export interface WidgetContribution extends ElementContribution {
  type: string;
  provider: string;
  titleKey: string;
  icon?: string;
  /** @deprecated Svelte-экспорт модуля; загрузчик оборачивает его в CE и заполняет element. */
  component?: string;
  /** @deprecated Svelte-экспорт шапки; загрузчик заполняет headerElement. */
  headerComponent?: string;
  /** CE-тег компонента в шапке виджета. */
  headerElement?: string;
  defaultSize?: WidgetSize;
  minSize?: WidgetSize;
}

/**
 * Chip contributed by a plugin.
 *
 * Чип = glanceable-состояние + одно действие. Рендерится в QuickAccessPanel
 * (flow-wrap полоса под баннерами). Хост инжектит в CE свойства:
 * - mpuApi (PluginApi)
 * - mpuChip (QuickChipLayoutItem — дескриптор экземпляра)
 *
 * Плагин перечисляет доступные предметы через pickerElement (CE-каталог),
 * хост не читает бизнес-данные плагинов.
 */
export interface ChipContribution {
  /** Тип чипа (внутри плагина: 'temperature'/'macro'/...). */
  type: string;
  /** Провайдер (имя плагина-владельца: обычно совпадает с manifest.id). */
  provider: string;
  /** i18n-ключ заголовка (для picker-диалога и ария-лейблов). */
  titleKey: string;
  /** CE-тег чипа (mpu-<plugin>-chip-<type>). */
  element: string;
  /** CE-тег picker-каталога доступных экземпляров для edit-режима. */
  pickerElement: string;
  /** Иконка (опционально, для picker-диалога). */
  icon?: string;
}

/**
 * Один размещённый чип в QuickAccessPanel.
 * Хранится в per-printer settings (та же sync-семантика, что у dashboardLayout).
 */
export interface QuickChipLayoutItem {
  /** Стабильный instance-id (генерирует хост при добавлении). */
  instanceId: string;
  /** ChipContribution.type */
  type: string;
  /** ChipContribution.provider */
  provider: string;
  /** Ключ предмета внутри плагина (имя сенсора/макроса/девайса). */
  id: string;
  /** Опциональная метка от пользователя (rename в edit-режиме). */
  label?: string;
}

/**
 * Overlay contributed by a plugin.
 *
 * Floating layer above main and right panel.
 * Visibility is controlled by the plugin itself.
 */
export interface OverlayContribution extends SurfaceContribution {}

/**
 * Banner contributed by a plugin.
 *
 * In-flow block above main content.
 * Visibility is controlled by the plugin itself.
 */
export interface BannerContribution extends SurfaceContribution {
  scope?: 'all' | 'dashboard';
}

/**
 * Printer panel contribution.
 *
 * CE-элемент рендерится ПО ОДНОМУ ЭКЗЕМПЛЯРУ НА КАЖДЫЙ настроенный принтер
 * в fleet-режиме (fullscreen-слой ниже шапки, `?fleet=1`).
 *
 * Хост инжектит в CE стандартные свойства:
 *   api     — PluginApi
 *   params  — { printerId: string }
 *
 * Плагин читает данные своего принтера через api.moonrakerFor(params.printerId).
 * Видимость секции (mount/unmount) решает хост по режиму fleet.
 *
 * Не уникальный слот: несколько плагинов могут декларировать printerPanels —
 * в каждой карточке принтера монтируется стек вкладов по порядку регистрации
 * (как banners).
 */
export interface PrinterPanelContribution extends SurfaceContribution {
  titleKey?: string;
}

/**
 * Right panel contribution.
 *
 * Unique slot.
 * Loader accepts this ONLY from '@core/system'.
 */
export interface RightPanelContribution extends SurfaceContribution {}

/**
 * Область действия горячей клавиши.
 * - global    — везде, на любых поверхностях (дашборд, страницы, Settings);
 * - dashboard — только на дашборде;
 * - plugin    — только на странице плагина-владельца.
 */
export type HotkeyScope = 'global' | 'dashboard' | 'plugin';

/**
 * Hotkey contributed by a plugin.
 *
 * keys — комбинация вида "Ctrl+Shift+K", "Alt+1", "Shift+/", "F5", "Escape".
 * Буквы, цифры и знаки препинания сопоставляются по физической клавише
 * (не зависят от раскладки).
 * handler — имя экспорта entry-модуля с сигнатурой
 * (api: PluginApi, event: KeyboardEvent) => void | Promise<void>.
 *
 * Конфликты (одинаковая комбинация):
 * - global конфликтует с любым другим вкладом;
 * - dashboard + dashboard — конфликт;
 * - dashboard + plugin — допустимо;
 * - plugin + plugin — допустимо у РАЗНЫХ плагинов, у одного плагина — конфликт.
 * Конфликтующие вклады отключаются ВСЕ, хост пишет предупреждение.
 *
 * Модификаторы: Ctrl, Alt (Option), Shift, Meta (Cmd/Win) и платформенный Mod
 * (= Cmd на macOS, Ctrl на остальных). Совпадение по модификаторам точное.
 */
export interface HotkeyContribution {
  id: string;
  keys: string;
  scope: HotkeyScope;
  handler: string;
  /** i18n-ключ описания (для About/Debug). */
  titleKey?: string;
  /**
   * Срабатывать ли, когда фокус в поле ввода/редакторе.
   * По умолчанию — только для комбинаций с Ctrl/Alt/Meta. Поставьте false для
   * комбинаций, которые в полях ввода имеют своё значение (Ctrl+стрелки и т.п.).
   */
  allowInInputs?: boolean;
}

/**
 * Контекст, в котором принимается решение гарда. Добавлен в фазе 2
 * мультипринтерных гардов: обработчик видит, на какой принтер направлен
 * request — это позволяет держать состояние per-printer (например, статус
 * печати/хоминга) и принимать решение по состоянию ЦЕЛИ, а не активного.
 */
export interface GuardContext {
  /** Принтер-адресат request().
   *  - для api.moonraker().request() — активный принтер на момент вызова;
   *  - для api.moonrakerFor(printerId).request() — переданный printerId. */
  readonly targetPrinterId: string;
}

/**
 * Guard contribution: preflight-проверка request() по строке метода.
 * match — точная строка метода или глоб с '*'; параметры НЕ матчатся.
 * handler — имя экспорта entry-модуля с сигнатурой
 * (request, token, ctx) => GuardDecision | Promise<GuardDecision>.
 *
 * Третий аргумент ctx аддитивен: обработчики, написанные под старую
 * сигнатуру (request, token), продолжают работать без изменений — JS
 * игнорирует лишние аргументы.
 *
 * Токен передаётся обработчику ДО решения: при freeze плагин сохраняет его
 * и позже вызывает api.guards.resume(token, …).
 */
export interface GuardContribution {
  id: string;
  match: string[];
  handler: string;
}

export type GuardDecision =
  | { action: 'allow' }
  | { action: 'deny'; reasonKey?: string }
  | { action: 'freeze' };

/**
 * Static plugin manifest.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;

  pages?: PageContribution[];
  widgets?: WidgetContribution[];

  overlays?: OverlayContribution[];
  banners?: BannerContribution[];
  rightPanel?: RightPanelContribution;
  chips?: ChipContribution[];
  printerPanels?: PrinterPanelContribution[];

  locales?: string[];
  defaultSettings?: Record<string, unknown>;

  hotkeys?: HotkeyContribution[];

  guards?: GuardContribution[];
}

/**
 * Per-plugin settings API.
 * Backed by localStorage in host.
 */
export interface PluginSettingsApi {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  onChange(callback: (key: string, value: unknown) => void): () => void;
}

/**
 * i18n API exposed to plugins.
 */
export interface PluginI18nApi {
  t(key: string, params?: Record<string, string | number>): string;
  readonly locale: string;
}

/**
 * Theme API exposed to plugins.
 */
export interface PluginThemeApi {
  readonly current: ThemeMode;
}

/**
 * Subscription options for Moonraker proxy.
 */
export interface MoonrakerSubscriptionOptions {
  immediate?: boolean;
}

/**
 * Moonraker payloads are protocol-level dynamic data.
 * We intentionally keep them loose here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MoonrakerStatusDelta = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MoonrakerEventParams = any;

/**
 * Handle to the Moonraker proxy for the active printer.
 *
 * Notes:
 * - subscribe() returns current snapshot to new subscribers
 * - httpBaseUrl is used for binary operations (upload/download/thumbnails)
 * - readyState and connection callbacks are infrastructure-only
 */
export interface MoonrakerProxyHandle {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;

  subscribe(
    objects: Record<string, string[]>,
    callback: (delta: MoonrakerStatusDelta) => void,
    options?: MoonrakerSubscriptionOptions,
  ): () => void;

  onNotify(event: string, callback: (params: MoonrakerEventParams) => void): () => void;

  readonly httpBaseUrl: string;
  readonly readyState: ConnectionStatus;

  readonly authToken: string | null;

  onReady(callback: () => void): () => void;
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): () => void;

  /**
   * Декларация потребности в свежести кэша: прокси поллит метод с интервалом
   * intervalMs (min-интервал по всем регистрациям того же method+params,
   * refcounted) и освежает те же кэши (snapshot или TTL), которые читает
   * request(). Обходит GuardAgent (внутренний refresh, только чтения);
   * методы с побочным эффектом отклоняются с предупреждением.
   * Возвращает unreg; поллинг останавливается с последней регистрацией.
   */
  poll(method: string, params: unknown, intervalMs: number): () => void;
}

/**
 * Фильтр-тег fleet-индекса. Хост не знает смысла `id`: он только строит из
 * тегов кнопки фильтров (подпись — i18n.t(labelKey), иконка — из набора
 * plugins/shared/icons по имени `icon`) и сравнивает id.
 */
export interface FleetTag {
  id: string;
  labelKey: string;
  icon?: string;
  /** Порядок кнопки среди остальных тегов (меньше — левее). По умолчанию 0. */
  order?: number;
}

/**
 * Запись fleet-индекса принтера: непрозрачные данные для поиска и фильтров.
 * Хост хранит и сопоставляет их, но не интерпретирует (это единственный
 * канал плагин → хост, см. docs/architecture.md).
 */
export interface FleetIndexEntry {
  tags: FleetTag[];
  /** Текст для поиска (подстрока без учёта регистра). Пустая строка — нет. */
  searchText: string;
}

/**
 * Публикация индекса для fleet-режима. Запись привязана к паре
 * (плагин, принтер): publish заменяет прежнюю запись целиком,
 * retract снимает её (вызывать при размонтировании панели).
 */
export interface PluginFleetApi {
  publish(printerId: string, entry: FleetIndexEntry): void;
  retract(printerId: string): void;
}

/**
 * Runtime API handed to a plugin.
 */
export interface PluginApi {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly printer: PrinterInfo;

  /** MOONRAKER */

  /** legacy - for active printer only */
  moonraker(): MoonrakerProxyHandle;
  /** multiprinter */
  moonrakerFor(printerId: string): MoonrakerProxyHandle;


  /** Read-only - all printers */
  readonly printers: PrinterInfo[];

  /** Changing */
  setActivePrinter(id: string | null): void;

  /** Subscribe on printer list change */
  onPrintersChange(callback: (printers: PrinterInfo[]) => void): () => void;
  onPrinterChange(callback: (printer: PrinterInfo) => void): () => void;
  onLocaleChange(callback: (locale: string, dir: LocaleDirection) => void): () => void;
  onThemeChange(callback: (theme: ThemeMode) => void): () => void;


  /** SETTINGS */
  /** legacy - for active printer only */
  settings: PluginSettingsApi;
  /** multiprinter   */
  settingsFor(printerId: string): PluginSettingsApi;

  i18n: PluginI18nApi;
  /** Fleet-индекс: публикация тегов и текста для поиска/фильтров fleet-режима. */
  readonly fleet: PluginFleetApi;
  guards: {
    resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void;
  };
  readonly theme: PluginThemeApi;
}