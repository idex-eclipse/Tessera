/**
 * Решает, пора ли свернуть поверхности над контентом при скролле вниз.
 *
 * Опорная точка следует за пальцем вверх и переносится на текущую позицию после каждого
 * срабатывания, поэтому поверхность, раскрытая нажатием посреди страницы, не свернётся
 * от первого же случайного движения: снова нужно проскроллить больше порога.
 * У каждого контейнера своя опорная точка: новый контейнер начинает с нуля, так что
 * один большой шаг колеса срабатывает сразу. Чистая логика: тестируется без DOM.
 */
export function createCollapseOnScroll({ threshold }: { threshold: number }) {
  const anchors = new WeakMap<object, number>();

  return {
    /** Новая позиция контейнера после прокрутки пользователем. true — пора свернуть. */
    update(source: object, y: number): boolean {
      const anchor = anchors.get(source) ?? 0;
      if (y < anchor) {
        anchors.set(source, y);
        return false;
      }
      if (y - anchor <= threshold) return false;
      anchors.set(source, y);
      return true;
    },

    /** Контейнер прокручен не пользователем: запомнить позицию, не сворачивая. */
    sync(source: object, y: number): void {
      anchors.set(source, y);
    },
  };
}
