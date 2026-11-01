export interface WidgetBox {
  width: number;
  height: number;
  narrow: boolean;
}

/**
 * Svelte-action: сообщает размеры области виджета и режим `narrow` от хоста.
 *
 * Вешается на обёртку без прокрутки: у элемента с `overflow: auto` появление полосы прокрутки
 * меняло бы ширину. Размеры — content-box, отступы обёртки в них не входят.
 *
 * `narrow` читается из `data-narrow` элемента поверхности: `defineMpuElement` не передаёт смену
 * `params` в живой компонент, а `useNarrow()` смотрит на окно, а не на сетку дашборда.
 */
export function observeWidgetBox(node: HTMLElement, onChange: (box: WidgetBox) => void) {
  let cb = onChange;
  const surface = node.closest<HTMLElement>('[data-narrow]');
  const readNarrow = (): boolean => surface?.dataset.narrow === 'true';

  const box: WidgetBox = { width: 0, height: 0, narrow: readNarrow() };
  const emit = (): void => cb({ ...box });
  emit();

  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          box.width = entry.contentRect.width;
          box.height = entry.contentRect.height;
          emit();
        });
  resize?.observe(node);

  const mutation = surface
    ? new MutationObserver(() => {
        box.narrow = readNarrow();
        emit();
      })
    : null;
  if (surface) mutation?.observe(surface, { attributes: true, attributeFilter: ['data-narrow'] });

  return {
    update(next: (box: WidgetBox) => void) {
      cb = next;
    },
    destroy() {
      resize?.disconnect();
      mutation?.disconnect();
    },
  };
}
