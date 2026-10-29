/**
 * Поповер чипа выравнивается по «начальному» краю чипа (слева в LTR, справа в RTL).
 * Если по этой стороне он выходит за экран — выравнивается по «конечному» краю.
 * Чистая функция: тестируется без DOM.
 */
export function shouldAlignToEnd(
  rect: { left: number; right: number },
  popoverWidth: number,
  viewportWidth: number,
  rtl: boolean,
): boolean {
  return rtl ? rect.right - popoverWidth < 0 : rect.left + popoverWidth > viewportWidth;
}

/**
 * Открывать поповер чипа вверх?
 *
 * По умолчанию — вниз: чипы стоят в верхней полосе под баннерами, и поповер вверх закрыл бы их и
 * шапку. Вверх — только если снизу поповер (высотой `popoverHeight`) не помещается, а сверху
 * места больше, чем снизу. Чистая функция: тестируется без DOM.
 */
export function shouldOpenAbove(
  rect: { top: number; bottom: number },
  popoverHeight: number,
  viewportHeight: number,
): boolean {
  const spaceBelow = viewportHeight - rect.bottom - 6;
  return spaceBelow < popoverHeight && rect.top > spaceBelow;
}

/** Страница в RTL? (host выставляет dir на <html>) */
export function isRtl(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('dir') === 'rtl';
}
