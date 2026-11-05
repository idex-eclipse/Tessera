<script lang="ts">
  import { colorToCss, isLit, type Rgbw } from '../../lib/led-data';

  let {
    pixels,
    selected = [],
    onSelect = null,
    allLabel = '',
  }: {
    pixels: Rgbw[];
    /** выбранные пиксели (0-based); пусто = вся цепочка */
    selected?: number[];
    /** null — только просмотр */
    onSelect?: ((next: number[]) => void) | null;
    allLabel?: string;
  } = $props();

  let anchor = $state<number | null>(null);

  function click(i: number, e: MouseEvent): void {
    if (!onSelect) return;
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      onSelect(Array.from({ length: b - a + 1 }, (_, k) => a + k));
      return;
    }
    anchor = i;
    if (e.ctrlKey || e.metaKey) {
      onSelect(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]);
    } else {
      onSelect(selected.length === 1 && selected[0] === i ? [] : [i]);
    }
  }
</script>

<div class="strip" class:single={pixels.length === 1}>
  {#if onSelect && pixels.length > 1}
    <button
      class="all"
      class:active={selected.length === 0}
      onclick={() => {
        anchor = null;
        onSelect?.([]);
      }}
    >
      {allLabel}
    </button>
  {/if}
  <div class="pixels">
    {#each pixels as px, i (i)}
      <button
        class="px"
        class:lit={isLit(px)}
        class:selected={selected.includes(i)}
        class:dim={selected.length > 0 && !selected.includes(i)}
        style:--px={colorToCss(px)}
        title={pixels.length > 1 ? `#${i + 1}` : undefined}
        disabled={!onSelect || pixels.length === 1}
        onclick={(e) => click(i, e)}
      ></button>
    {/each}
  </div>
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-width: 0;
  }

  .pixels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }

  .px {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 50%;
    background: var(--bg-surface-hover);
    cursor: pointer;
    transition: transform var(--transition-fast), opacity var(--transition-fast);
  }
  .px:disabled { cursor: default; }
  .px.lit {
    background: var(--px);
    box-shadow: 0 0 6px color-mix(in srgb, var(--px) 70%, transparent);
  }
  .px.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .px.dim { opacity: 0.45; }
  .px:not(:disabled):hover { transform: scale(1.15); }

  .single .px {
    width: 22px;
    height: 22px;
  }

  .all {
    flex-shrink: 0;
    padding: 2px var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .all.active {
    background: var(--accent-subtle-strong);
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
