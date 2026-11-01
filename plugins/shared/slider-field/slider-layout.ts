/**
 * Раскладка блоков со слайдерами по собственным размерам виджета.
 *
 * Решения считаются от размеров, которые не зависят от самого решения (ширина и высота области
 * виджета, естественная высота содержимого), поэтому режимы не переключаются по кругу.
 */

/** Поле ввода (120), сброс (24), отступы и короткая подпись. */
export const SLIDER_MIN_WIDTH = 240;
/** Совпадает с горизонтальным зазором SliderGrid (--space-md). */
export const SLIDER_COLUMN_GAP = 16;
/** Совпадает с зазором между блоками в виджетах (--space-sm). */
export const SECTION_GAP = 8;

const TWO_COLUMNS_WIDTH = SLIDER_MIN_WIDTH * 2 + SLIDER_COLUMN_GAP;

/** Пока ширина не измерена (0), считаем, что места хватает. */
export function sliderColumns(width: number, narrow: boolean): 1 | 2 {
  if (narrow) return 1;
  return width === 0 || width >= TWO_COLUMNS_WIDTH ? 2 : 1;
}

/** Блоки не помещаются в область виджета даже без заголовков аккордеонов. */
export function sectionsNeedAccordion(heights: number[], gap: number, available: number): boolean {
  if (available === 0) return false;
  const total = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(heights.length - 1, 0);
  return total > available;
}
