/**
 * Позиция popover справки (position: fixed) относительно якоря: строки секции,
 * кнопки «?» и т.п. Чистая арифметика, без DOM.
 */

export interface Anchor {
  left: number;
  top: number;
  bottom: number;
}

export interface Placement {
  left: number;
  /** задан, когда popover раскрывается вниз от якоря */
  top: number | null;
  /** расстояние от нижнего края окна; задано, когда popover раскрывается вверх */
  bottom: number | null;
  maxHeight: number;
}

export const HELP_WIDTH = 520;
const PREFERRED_HEIGHT = 360;
const GAP = 4;
const MIN_HEIGHT = 140;

export function placePopup(
  anchor: Anchor,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 8,
): Placement {
  const w = Math.min(size.w, viewport.w - margin * 2);
  const left = Math.max(margin, Math.min(anchor.left, viewport.w - w - margin));

  const below = viewport.h - anchor.bottom - GAP - margin;
  const above = anchor.top - GAP - margin;

  // вниз, если помещается или сверху места не больше; иначе вверх
  if (below >= Math.min(size.h, PREFERRED_HEIGHT) || below >= above) {
    return {
      left,
      top: anchor.bottom + GAP,
      bottom: null,
      maxHeight: Math.max(MIN_HEIGHT, below),
    };
  }
  return {
    left,
    top: null,
    bottom: viewport.h - anchor.top + GAP,
    maxHeight: Math.max(MIN_HEIGHT, above),
  };
}
