/**
 * Svelte-action: сообщает ширину (content-box) элемента при монтировании и при каждом её изменении.
 *
 * Для компонентов, которым адаптации одним CSS (@container) недостаточно — например, нужна другая
 * разметка (popover вместо колонок таблицы). Порог каждый компонент выбирает сам: ширину, при
 * которой его колонки перестают помещаться, а не абстрактный «мобильный» брейкпоинт.
 *
 * Подписка императивная (action, а не $effect) — подходит и для кода, где $effect не разрешён.
 */
export function observeWidth(node: HTMLElement, onChange: (width: number) => void) {
  let cb = onChange;
  if (typeof ResizeObserver === 'undefined') return {};

  const ro = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) cb(entry.contentRect.width);
  });
  ro.observe(node);

  return {
    update(next: (width: number) => void) {
      cb = next;
    },
    destroy() {
      ro.disconnect();
    },
  };
}
