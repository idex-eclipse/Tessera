<script lang="ts">
  import type { Snippet } from 'svelte';

  import Icon from './icons/Icon.svelte';

  export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
  }

  let {
    x,
    y,
    items,
    onSelect,
    onClose,
    aside = null,
  }: {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onSelect: (id: string) => void;
    onClose: () => void;
    aside?: Snippet | null;
  } = $props();

  let el = $state<HTMLElement | null>(null);
  let pos = $state({ left: -9999, top: -9999 });

  $effect(() => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    pos = {
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    };
  });
</script>

<svelte:window
  onkeydown={(e) => e.key === 'Escape' && onClose()}
  onclick={onClose}
  oncontextmenu={onClose}
  onresize={onClose}
/>

<div
  class="ctx-menu"
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  bind:this={el}
  onclick={(e) => e.stopPropagation()}
  oncontextmenu={(e) => e.preventDefault()}
  role="menu"
>
  <div class="ctx-items">
    {#each items as item (item.id)}
      <button
        class="ctx-item"
        class:danger={item.danger}
        disabled={item.disabled}
        role="menuitem"
        onclick={() => {
          onSelect(item.id);
          onClose();
        }}
      >
        {#if item.icon}
          <span class="ctx-icon"><Icon name={item.icon} /></span>
        {/if}
        {item.label}
      </button>
    {/each}
  </div>

  {#if aside}
    <div class="ctx-aside">{@render aside()}</div>
  {/if}
</div>

<style>
  .ctx-menu {
    position: fixed;
    z-index: 400;
    display: flex;
    align-items: stretch;
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }

  .ctx-items {
    min-width: 200px;
    display: flex;
    flex-direction: column;
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-md);
    text-align: left;
    cursor: pointer;
  }

  .ctx-item:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .ctx-item.danger { color: var(--danger); }
  .ctx-item.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }
  .ctx-item:disabled { opacity: 0.5; cursor: not-allowed; }

  .ctx-icon { display: flex; color: var(--text-muted); flex-shrink: 0; }
  .ctx-item.danger .ctx-icon { color: var(--danger); }

  .ctx-aside {
    display: flex;
    align-items: stretch;
    padding-left: var(--space-xs);
    margin-left: var(--space-xs);
    border-left: 1px solid var(--border-color);
  }
</style>