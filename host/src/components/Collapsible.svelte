<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Плавно сворачивает содержимое по высоте. Содержимое остаётся смонтированным и сохраняет
   * естественную высоту: плагины не теряют состояние, а высоту можно измерять и в свёрнутом виде.
   */
  let { open, children }: { open: boolean; children: Snippet } = $props();

  /** Совпадает с --transition-normal. */
  const TRANSITION_MS = 250;

  // В открытом виде не клипуем: иначе обрезаются тени, ✕ чипов и поповеры плагинов.
  // Таймер, а не transitionend: при отключённой анимации событие не придёт.
  let settled = $state(false);

  $effect(() => {
    if (!open) {
      settled = false;
      return;
    }
    const t = setTimeout(() => {
      settled = true;
    }, TRANSITION_MS);
    return () => clearTimeout(t);
  });
</script>

<div class="collapsible" class:open class:settled={settled && open}>
  <div class="collapsible-inner">
    {@render children()}
  </div>
</div>

<style>
  .collapsible {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 0fr;
    min-width: 0;
    transition: grid-template-rows var(--transition-normal);
  }

  .collapsible.open {
    grid-template-rows: 1fr;
  }

  /* visibility вместе с высотой: скрытое не получает фокус, но видно до конца сворачивания */
  .collapsible-inner {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    visibility: hidden;
    transition: visibility var(--transition-normal);
  }

  .collapsible.open > .collapsible-inner {
    visibility: visible;
  }

  .collapsible.settled > .collapsible-inner {
    overflow: visible;
  }

  @media (prefers-reduced-motion: reduce) {
    .collapsible,
    .collapsible-inner {
      transition: none;
    }
  }
</style>
