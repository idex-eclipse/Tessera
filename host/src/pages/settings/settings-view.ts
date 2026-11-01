export type SettingsView = 'wide' | 'list' | 'detail';

/**
 * Ширина страницы, меньше которой навигация и вкладка рядом не помещаются:
 * 200px навигации + зазор + минимум ~336px под вкладку. Брейкпоинт хоста (768px) тут не годится:
 * при окне 1280px с двумя панелями рабочая область всего ~650px, и вкладка рядом с навигацией ещё читается.
 */
export const SETTINGS_MIN_SPLIT_WIDTH = 560;

/** Мобильный режим хоста (панели стали drawer'ами) или страница слишком узкая для раскладки «рядом». */
export function settingsNarrow(windowNarrow: boolean, pageWidth: number): boolean {
  return windowNarrow || (pageWidth > 0 && pageWidth < SETTINGS_MIN_SPLIT_WIDTH);
}

/**
 * Что показывает страница настроек. Широкая область: навигация и вкладка рядом. Узкая: либо
 * список вкладок (`#/settings` без секции), либо одна вкладка поверх него (`#/settings/<id>`).
 */
export function settingsView(narrow: boolean, section: string | null): SettingsView {
  if (!narrow) return 'wide';
  return section ? 'detail' : 'list';
}
