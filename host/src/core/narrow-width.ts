import { NARROW_BREAKPOINT } from './ui-store.svelte.ts';

/**
 * Svelte-action: сообщает, уже ли элемент брейкпоинта хоста (NARROW_BREAKPOINT).
 *
 * Узость определяется шириной самой области (content-box), а не окном: при широком экране с двумя
 * открытыми сайдбарами рабочая область может быть уже 768px, и баннеры, чипы и сетка dashboard
 * должны получить мобильный вид. Вызывает `onChange` при монтировании и при каждой смене значения.
 */
export function narrowWidth(node: HTMLElement, onChange: (narrow: boolean) => void) {
  let current: boolean | null = null;
  let cb = onChange;

  const report = (width: number): void => {
    const next = width > 0 && width < NARROW_BREAKPOINT;
    if (next === current) return;
    current = next;
    cb(next);
  };

  if (typeof ResizeObserver === 'undefined') return {};

  const ro = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) report(entry.contentRect.width);
  });
  ro.observe(node);

  return {
    update(next: (narrow: boolean) => void) {
      cb = next;
    },
    destroy() {
      ro.disconnect();
    },
  };
}
