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

/** Страница в RTL? (host выставляет dir на <html>) */
export function isRtl(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('dir') === 'rtl';
}
