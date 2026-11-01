/** Доля высоты рабочей области, которую чипы могут занимать без аккордеона на широком экране. */
export const MAX_CHIPS_SHARE = 0.25;

/**
 * Нужен ли чипам аккордеон на широком экране. Высота естественная и не зависит от того,
 * открыт ли он, поэтому режимы не переключаются по кругу. Чистая функция: тестируется без DOM.
 */
export function chipsNeedAccordion(chipsHeight: number, available: number): boolean {
  return available > 0 && chipsHeight > available * MAX_CHIPS_SHARE;
}
