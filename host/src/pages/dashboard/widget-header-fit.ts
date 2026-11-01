/**
 * Нужно ли разнести шапку виджета на две строки: заголовок и блоки действий
 * вместе с зазорами не помещаются в доступную ширину. Заголовку без действий
 * переносить нечего. Чистая функция: тестируется без DOM.
 */
export function headerNeedsStacking(
  available: number,
  widths: readonly number[],
  gap: number,
): boolean {
  const present = widths.filter((width) => width > 0);
  if (present.length < 2) return false;

  const total = present.reduce((sum, width) => sum + width, 0);
  return total + gap * (present.length - 1) > available;
}
