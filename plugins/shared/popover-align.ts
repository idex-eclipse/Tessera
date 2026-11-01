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

const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * Координаты поповера чипа для `position: fixed`. Чипы на узком экране лежат в ленте с прокруткой,
 * и поповер с `position: absolute` она бы обрезала. Сторону и выравнивание решают
 * shouldOpenAbove / shouldAlignToEnd по оценочному размеру `popover`.
 * Чистая функция: тестируется без DOM.
 */
export function chipPopoverStyle(
  rect: { left: number; right: number; top: number; bottom: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  rtl: boolean,
): string {
  const vertical = shouldOpenAbove(rect, popover.height, viewport.height)
    ? `top: auto; bottom: ${viewport.height - rect.top + POPOVER_GAP}px;`
    : `top: ${rect.bottom + POPOVER_GAP}px; bottom: auto;`;

  // «Начальный» край чипа — левый в LTR и правый в RTL; при выравнивании по концу наоборот.
  const anchorLeft = shouldAlignToEnd(rect, popover.width, viewport.width, rtl) === rtl;
  const horizontal = anchorLeft
    ? `left: ${Math.max(VIEWPORT_MARGIN, rect.left)}px; right: auto;`
    : `left: auto; right: ${Math.max(VIEWPORT_MARGIN, viewport.width - rect.right)}px;`;

  return `${vertical} ${horizontal}`;
}

/** chipPopoverStyle для текущего окна и направления страницы. */
export function placeChipPopover(
  rect: { left: number; right: number; top: number; bottom: number },
  popover: { width: number; height: number },
): string {
  return chipPopoverStyle(rect, popover, { width: window.innerWidth, height: window.innerHeight }, isRtl());
}
