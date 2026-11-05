<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    actions,
    row = false,
    children,
  }: {
    title: string;
    /** кнопки в шапке справа */
    actions?: Snippet;
    /** тело карточки — строкой (кнопки), а не колонкой */
    row?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="panel">
  <header class="panel-header">
    <span class="panel-title">{title}</span>
    {@render actions?.()}
  </header>
  <div class="panel-body" class:row>
    {@render children()}
  </div>
</section>

<style>
  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    min-width: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }

  .panel-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .panel-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
  }

  .panel-body.row {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
  }
</style>
