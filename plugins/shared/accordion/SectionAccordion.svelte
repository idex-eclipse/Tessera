<script lang="ts">
  /**
   * Секция виджета, которая умеет быть аккордеоном. При `accordion=false` заголовка нет и содержимое
   * открыто, а DOM тот же: поля ввода не теряют состояние при смене режима. Содержимое всегда
   * смонтировано и сохраняет естественную высоту, поэтому `contentHeight` известна и в закрытом виде.
   */
  import { onMount, type Snippet } from 'svelte';
  import Icon from '../icons/Icon.svelte';

  let {
    title,
    accordion = true,
    open,
    onToggle,
    contentHeight = $bindable(0),
    children,
  }: {
    title: string;
    accordion?: boolean;
    open: boolean;
    onToggle: () => void;
    contentHeight?: number;
    children: Snippet;
  } = $props();

  /** Совпадает с --transition-normal. */
  const TRANSITION_MS = 250;
  /** Хватает на первые измерения виджета: при загрузке блоки не схлопываются на глазах. */
  const FIRST_LAYOUT_MS = 100;

  let expanded = $derived(!accordion || open);

  // В открытом виде не клипуем: иначе обрезаются легенды и рамки полей.
  // Таймер, а не transitionend: при отключённой анимации событие не придёт.
  let settled = $state(false);
  let animated = $state(false);

  $effect(() => {
    if (!expanded) {
      settled = false;
      return;
    }
    const t = setTimeout(() => {
      settled = true;
    }, TRANSITION_MS);
    return () => clearTimeout(t);
  });

  onMount(() => {
    const t = setTimeout(() => {
      animated = true;
    }, FIRST_LAYOUT_MS);
    return () => clearTimeout(t);
  });
</script>

<div class="section">
  {#if accordion}
    <button class="section-head" class:open={expanded} onclick={onToggle} aria-expanded={expanded}>
      <span class="section-chevron"><Icon name="chevron-down" size={14} /></span>
      <span class="section-title">{title}</span>
    </button>
  {/if}

  <div class="section-body" class:animated class:open={expanded} class:settled={settled && expanded}>
    <div class="section-inner">
      <div class="section-content" bind:clientHeight={contentHeight}>
        {@render children()}
      </div>
    </div>
  </div>
</div>

<style>
  .section {
    flex-shrink: 0;
    min-width: 0;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    width: 100%;
    min-height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .section-head:hover {
    color: var(--text-primary);
  }

  .section-chevron {
    display: flex;
    flex-shrink: 0;
    line-height: 0;
    transform: rotate(-90deg);
  }

  :global([dir='rtl']) .section-chevron {
    transform: rotate(90deg);
  }

  .section-head.open .section-chevron {
    transform: none;
  }

  .section-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 0fr;
  }

  .section-body.open {
    grid-template-rows: 1fr;
  }

  /* visibility вместе с высотой: скрытое не получает фокус, но видно до конца сворачивания */
  .section-inner {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    visibility: hidden;
  }

  .section-body.open > .section-inner {
    visibility: visible;
  }

  .section-body.settled > .section-inner {
    overflow: visible;
  }

  .section-body.animated {
    transition: grid-template-rows var(--transition-normal);
  }

  .section-body.animated > .section-inner {
    transition: visibility var(--transition-normal);
  }

  .section-head .section-chevron {
    transition: transform var(--transition-normal);
  }

  @media (prefers-reduced-motion: reduce) {
    .section-body.animated,
    .section-body.animated > .section-inner,
    .section-head .section-chevron {
      transition: none;
    }
  }
</style>
