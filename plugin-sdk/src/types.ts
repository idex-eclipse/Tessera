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
 *   interprets them; api.notifications is write-only into the host notification center)
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
 * - api (PluginApi)
 * - params (chipId, chipLabel?, edit, narrow)
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
 * Collapsed view of a banner of the same plugin.
 *
 * Shown by the host instead of the banner while the banner surface is collapsed
 * on a narrow screen. Display-only: a click bubbles up to the host and expands
 * the surface (call stopPropagation() for a control of your own).
 */
export interface CollapsedBannerContribution extends SurfaceContribution {
  /** BannerContribution.id of the banner this view belongs to. */
  banner: string;
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
 * Вид точки расширения — контракт того, что дополнение даёт владельцу:
 * - tab     — содержимое вкладки (element); кнопку вкладки рисует владелец;
 * - panel   — тело (element) и опц. шапка (headerElement); оболочку панели рисует хост;
 * - element — свободный элемент без хрома; когда показывать нечего, рендерит пустоту;
 * - action  — команда без UI: экспорт handler(api, context); кнопку/пункт рисует владелец.
 */
export type ExtensionKind = 'tab' | 'panel' | 'element' | 'action';

/**
 * Режим точки:
 * - append      — вклады добавляются к оригиналу владельца (до max);
 * - alternative — оригинал и вклады — варианты, пользователь выбирает (ПКМ → popover хоста);
 * - replacement — единственный вклад рендерится вместо оригинала, без переключения.
 */
export type ExtensionMode = 'append' | 'alternative' | 'replacement';

/**
 * Точка расширения, объявленная плагином-владельцем.
 * Адрес точки: `<ownerPluginId>#<id>`. Где точка стоит на экране, решает владелец.
 */
export interface ExtensionPointDecl {
  /** Уникален внутри плагина. */
  id: string;
  kind: ExtensionKind;
  /** По умолчанию 'append'. action бывает только append. */
  mode?: ExtensionMode;
  /** Мажор контракта params/context. Вклад с другим мажором отбрасывается. */
  version: number;
  /** Только append: ёмкость точки (по умолчанию без ограничения). */
  max?: number;
  /** Только alternative: вариант, пока пользователь не выбирал (по умолчанию 'extension'). */
  default?: 'extension' | 'original';
  /** Название точки в диалогах хоста и Settings → Plugins. */
  titleKey?: string;
}

/**
 * Вклад дополнения в точку другого (или своего) плагина.
 */
export interface ExtensionContribution {
  /** Адрес точки: `<ownerPluginId>#<pointId>`. */
  point: string;
  /** Должен совпадать с kind точки. */
  kind: ExtensionKind;
  /** Мажор контракта, под который написан вклад. */
  version: number;
  /** Уникален внутри дополнения. */
  id: string;
  titleKey: string;
  /** CE-тег: tab | panel | element. */
  element?: string;
  /** CE-тег шапки: только panel. */
  headerElement?: string;
  /** Только action: экспорт модуля (api, context) => void | Promise<void>. */
  handler?: string;
  /** action: иконка пункта (имя встроенной иконки). */
  icon?: string;
  /** Экспорт модуля (api, params) => boolean | Promise<boolean>; нет — доступен всегда. */
  available?: string;
  /** Порядок среди вкладов точки (меньше — раньше). По умолчанию 0. */
  order?: number;
}

/** Вклад в точке глазами владельца. */
export interface ExtensionRef {
  /** `<extPluginId>/<id>` */
  ref: string;
  pluginId: string;
  kind: ExtensionKind;
  /** Уже переведённый titleKey. */
  title: string;
  icon?: string;
  order: number;
}

/** Что показывать в точке сейчас (для активного принтера и переданных params). */
export interface ExtensionPointState {
  /** Режим точки; null — плагин такую точку не объявлял. */
  mode: ExtensionMode | null;
  /** Рендерить ли оригинал владельца (всегда true для append). */
  original: boolean;
  /** Активные вклады (append — все, alternative/replacement — не больше одного). */
  active: ExtensionRef[];
  /** alternative: все доступные варианты (без оригинала). */
  options: ExtensionRef[];
  /** У точки неразрешённый конфликт: её вклады выключены. */
  conflict: boolean;
}

/** Смонтированный вклад: обновить params или снять. */
export interface ExtensionMount {
  update(params: MpuParams): void;
  destroy(): void;
}

/**
 * API владельца точек (api.extensions). Все pointId — id точек СВОЕГО плагина.
 */
export interface PluginExtensionsApi {
  /** Активные вклады точки, в порядке. */
  list(pointId: string, params?: MpuParams): ExtensionRef[];
  resolve(pointId: string, params?: MpuParams): ExtensionPointState;
  /** Любое изменение: загрузка/выключение плагинов, доступность, выбор, конфликты. */
  onChange(callback: () => void): () => void;
  /** Монтирует вклад (tab/panel/element) в контейнер с api дополнения. */
  mount(container: HTMLElement, ref: string, params?: MpuParams): ExtensionMount;
  /** Только action. Ошибки handler'а изолированы и логируются. */
  invoke(ref: string, context?: unknown): Promise<void>;
  /** alternative: выбранный вклад; null — оригинал; undefined — выбора не было. */
  choice(pointId: string): string | null | undefined;
  setChoice(pointId: string, ref: string | null): void;
  /** alternative: открыть popover выбора хоста у anchor. */
  openChooser(pointId: string, anchor: HTMLElement | { x: number; y: number }, params?: MpuParams): void;
}

/**
 * Static plugin manifest.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  /**
   * Минимальная версия контракта плагинов "MAJOR.MINOR" (см. api-level.ts). Нет поля — "0.7".
   * Хост с другим MAJOR или меньшим MINOR плагин не грузит и не ставит.
   */
  pluginApi?: string;
  /**
   * Минимальные версии плагинов, от которых зависит этот: `{ "<pluginId>": "X.Y.Z" }` (>=).
   * Владельцы точек из `extensions` — зависимости и без записи (любая версия); запись
   * нужна, когда точка появилась в определённой версии владельца (см. dependencies.ts).
   */
  dependencies?: Record<string, string>;

  pages?: PageContribution[];
  widgets?: WidgetContribution[];

  overlays?: OverlayContribution[];
  banners?: BannerContribution[];
  collapsedBanners?: CollapsedBannerContribution[];
  rightPanel?: RightPanelContribution;
  chips?: ChipContribution[];
  printerPanels?: PrinterPanelContribution[];

  locales?: string[];
  defaultSettings?: Record<string, unknown>;

  hotkeys?: HotkeyContribution[];

  guards?: GuardContribution[];

  /** Точки, в которые другие плагины могут встраиваться. */
  extensionPoints?: ExtensionPointDecl[];
  /** Вклады в точки других плагинов. */
  extensions?: ExtensionContribution[];
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
   * методы из списка «никогда не кэшируются» отклоняются с предупреждением,
   * остальные методы с побочным эффектом не распознаются: не поллите их.
   * Возвращает unreg; поллинг останавливается с последней регистрацией.
   */
  poll(method: string, params: unknown, intervalMs: number): () => void;

  /**
   * Декларация потребности в bulk-потоке Klipper (raw-мост Moonraker
   * `/klippysocket`, того же origin, что и основной сокет). Сокет открывает и
   * ведёт хост: плагин своих сокетов не создаёт. Подписки с одинаковым
   * method+params делят один поток (refcount); поток идёт, пока есть
   * слушатели, с последней отменой сокет закрывается (у Klipper нет отписки),
   * поэтому отменяйте, когда данные не нужны (скрытый график, ушли с вкладки).
   * Обходит GuardAgent (только чтение). Разрешены методы из списка хоста
   * (сейчас `load_cell/dump_force`, params `{ load_cell: '<имя>' }`); другие
   * отклоняются с предупреждением, возвращается пустая функция.
   *
   * `onData` получает `params` каждого сообщения потока, для `load_cell/dump_force`:
   * `{ data: [[time, force_g | null, counts, tare | null], …] }`.
   * `onStatus`: сразу текущее состояние, затем при каждом изменении; `unavailable` —
   * моста нет (nginx без `/klippysocket`, mixed content) или Klipper отклонил подписку;
   * хост повторяет подключение сам с паузой, плагину достаточно показать запасной вариант.
   * Возвращает unreg.
   */
  klippyStream(
    method: string,
    params: Record<string, unknown>,
    onData: (data: unknown) => void,
    onStatus?: (status: KlippyStreamStatus) => void,
  ): () => void;
}

export type KlippyStreamStatus = 'connecting' | 'live' | 'unavailable';

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

export type NotificationSeverity = 'critical' | 'error' | 'info';

/**
 * Уведомление в центр уведомлений хоста (api.notifications.push).
 */
export interface NotificationInput {
  severity: NotificationSeverity;
  /** Уже локализованный текст (плагин сам вызывает api.i18n.t). Свыше 240 символов обрезается. */
  text: string;
  /**
   * Короткая локализованная подпись источника (например, «TMC»). Без неё хост
   * показывает название плагина.
   */
  label?: string;
  /** Принтер, к которому относится уведомление. По умолчанию — активный принтер. */
  printerId?: string;
}

/**
 * Центр уведомлений хоста: общий для всех плагинов. Только запись — плагины не
 * читают чужие уведомления (это был бы канал между плагинами). Автора
 * (pluginId) проставляет хост. Доступно с pluginApi "0.10".
 */
export interface PluginNotificationsApi {
  push(notification: NotificationInput): void;
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
  /** Центр уведомлений хоста (только запись). */
  readonly notifications: PluginNotificationsApi;
  guards: {
    resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void;
  };
  readonly theme: PluginThemeApi;
  /** Точки расширения этого плагина (для владельца). */
  readonly extensions: PluginExtensionsApi;
}