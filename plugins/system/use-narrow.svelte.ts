/**
 * Реактивный флаг «узкий экран» для компонентов плагина.
 *
 * Значение совпадает с брейкпоинтом хоста (NARROW_BREAKPOINT = 768px). Params
 * поверхности после монтирования не реактивны, поэтому слушаем media query сами.
 *
 * Без $effect (правило для *.svelte.ts): один модульный слушатель на всё окно,
 * подписка императивная и ленивая — при первом вызове.
 */
const NARROW_QUERY = '(max-width: 768px)';

let narrow = $state(false);
let bound = false;

function bind(): void {
  if (bound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  bound = true;
  const mql = window.matchMedia(NARROW_QUERY);
  narrow = mql.matches;
  mql.addEventListener('change', (e) => {
    narrow = e.matches;
  });
}

export function useNarrow(): { readonly value: boolean } {
  bind();
  return {
    get value(): boolean {
      return narrow;
    },
  };
}
