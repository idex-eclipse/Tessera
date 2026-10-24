/**
 * Позиция каретки в textarea с `white-space: pre` (без переносов) и моноширинным шрифтом.
 *
 * Строка = число "\n" до курсора, колонка = визуальная колонка в этой строке
 * (табуляция выравнивает по tab-size). Эти числа, умноженные на ширину символа и
 * высоту строки, дают координаты каретки без зеркального DOM-элемента.
 */
export function caretLineCol(
  text: string,
  cursor: number,
  tabSize = 4,
): { line: number; col: number } {
  const end = Math.max(0, Math.min(cursor, text.length));

  let line = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) line++;

  const lineStart = text.lastIndexOf('\n', end - 1) + 1;
  let col = 0;
  for (let i = lineStart; i < end; i++) {
    col += text[i] === '\t' ? tabSize - (col % tabSize) : 1;
  }
  return { line, col };
}
