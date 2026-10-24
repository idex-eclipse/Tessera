import type {
  BannerContribution,
  ChipContribution,
  OverlayContribution,
  PageContribution,
  PluginManifest,
  PrinterPanelContribution,
  RightPanelContribution,
  WidgetContribution,
} from '../../../plugin-sdk/src/types';

/**
 * Единая модель вкладов плагинов (surfaces).
 *
 * Один источник правды для реестра, загрузчика и компонентов хоста:
 * - SURFACE_KINDS — множественные поверхности (список вкладов на плагин);
 * - SURFACE_SPECS — валидатор и метка для логов каждого вида;
 * - SINGLETON_SURFACES — уникальные слоты (сейчас только rightPanel).
 *
 * Чтобы добавить новый вид поверхности: тип в plugin-sdk, поле в
 * PluginManifest, запись в SurfaceContributionMap + SURFACE_SPECS.
 */

/** Вклад + плагин-владелец. Общая форма записи реестра для всех поверхностей. */
export interface RegisteredContribution<C> {
  pluginId: string;
  contribution: C;
}

/** Множественные поверхности: ключ = поле манифеста. */
export interface SurfaceContributionMap {
  pages: PageContribution;
  widgets: WidgetContribution;
  overlays: OverlayContribution;
  banners: BannerContribution;
  chips: ChipContribution;
  printerPanels: PrinterPanelContribution;
}

/** Уникальные поверхности: ключ = поле манифеста. */
export interface SingletonSurfaceContributionMap {
  rightPanel: RightPanelContribution;
}

export type SurfaceKind = keyof SurfaceContributionMap;
export type SingletonSurfaceKind = keyof SingletonSurfaceContributionMap;

export type Registered<K extends SurfaceKind> = RegisteredContribution<SurfaceContributionMap[K]>;
export type RegisteredSingleton<K extends SingletonSurfaceKind> =
  RegisteredContribution<SingletonSurfaceContributionMap[K]>;

export type RegisteredPage = Registered<'pages'>;
export type RegisteredWidget = Registered<'widgets'>;
export type RegisteredOverlay = Registered<'overlays'>;
export type RegisteredBanner = Registered<'banners'>;
export type RegisteredChip = Registered<'chips'>;
export type RegisteredPrinterPanel = Registered<'printerPanels'>;
export type RegisteredRightPanel = RegisteredSingleton<'rightPanel'>;

/** Порядок = порядок регистрации/санитайза. */
export const SURFACE_KINDS = [
  'pages',
  'widgets',
  'overlays',
  'banners',
  'chips',
  'printerPanels',
] as const satisfies readonly SurfaceKind[];

export const SINGLETON_SURFACES = ['rightPanel'] as const satisfies readonly SingletonSurfaceKind[];

/** Плагин-владелец уникального слота rightPanel (решение L). */
export const RIGHT_PANEL_OWNER_PLUGIN_ID = '@core/system';

/** Вклады, у которых контракт — «Custom Element по тегу» без доп. полей. */
export interface SurfaceSpec {
  /** Метка для предупреждений загрузчика: `invalid <label> contribution`. */
  label: string;
  /**
   * Структурная проверка вклада. Отсутствует у pages/widgets: они допускают
   * legacy-форму `component` и проверяются после normalizeContribs.
   */
  validate?: (value: unknown) => boolean;
  /** Плагин с такими вкладами активируется loader'ом eagerly на старте. */
  persistent: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasStrings(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => isNonEmptyString(record[key]));
}

const ID_AND_ELEMENT = ['id', 'element'] as const;

export const SURFACE_SPECS: Record<SurfaceKind, SurfaceSpec> = {
  pages: { label: 'page', persistent: false },
  widgets: { label: 'widget', persistent: false },
  overlays: {
    label: 'overlay',
    validate: (v) => hasStrings(v, ID_AND_ELEMENT),
    persistent: true,
  },
  banners: {
    label: 'banner',
    validate: (v) => hasStrings(v, ID_AND_ELEMENT),
    persistent: true,
  },
  chips: {
    label: 'chip',
    validate: (v) => hasStrings(v, ['type', 'provider', 'titleKey', 'element', 'pickerElement']),
    persistent: true,
  },
  printerPanels: {
    label: 'printerPanel',
    validate: (v) => hasStrings(v, ID_AND_ELEMENT),
    persistent: true,
  },
};

export const SINGLETON_SPECS: Record<SingletonSurfaceKind, SurfaceSpec> = {
  rightPanel: {
    label: 'rightPanel',
    validate: (v) => hasStrings(v, ID_AND_ELEMENT),
    persistent: true,
  },
};

/** Список вкладов вида `kind` из манифеста (пустой массив, если нет). */
export function contributionsOf<K extends SurfaceKind>(
  manifest: PluginManifest,
  kind: K,
): SurfaceContributionMap[K][] {
  return (manifest[kind] ?? []) as SurfaceContributionMap[K][];
}

/** Есть ли у манифеста постоянные поверхности (требуют eager-активации). */
export function hasPersistentSurfaces(manifest: PluginManifest): boolean {
  return (
    SURFACE_KINDS.some(
      (kind) => SURFACE_SPECS[kind].persistent && contributionsOf(manifest, kind).length > 0,
    ) || SINGLETON_SURFACES.some((kind) => Boolean(manifest[kind]))
  );
}
