/** Кнопка шага (44) и зазор строки оси (2). */
const STEP_BUTTON_WIDTH = 46;
/** Минимальная ширина поля положения в строке оси. */
const POSITION_FIELD_WIDTH = 100;

/** Ширина строки оси в режиме «Строки»: шаги по обе стороны от поля положения. */
export function rowsMinWidth(stepCount: number): number {
  return 2 * stepCount * STEP_BUTTON_WIDTH + POSITION_FIELD_WIDTH;
}

/** Пока ширина не измерена (0), считаем, что строки помещаются. */
export function rowsFit(width: number, stepCount: number): boolean {
  return width === 0 || width >= rowsMinWidth(stepCount);
}

/** Строка force move: по три шага с каждой стороны и короткое имя шаговика. */
const FORCE_MOVE_ROW_WIDTH = 6 * STEP_BUTTON_WIDTH + 60;

export function forceMoveRowFit(width: number): boolean {
  return width === 0 || width >= FORCE_MOVE_ROW_WIDTH;
}
