<script lang="ts">
  /**
   * Секция-аккордеон для picker-каталогов чипов (и любых длинных списков выбора).
   * Shared-кирпич: механика и визуал здесь, контент — children-сниппет владельца.
   * Дефолт — свёрнуто; счётчик предметов виден без раскрытия.
   */
  import type { Snippet } from 'svelte';
  import Icon from './icons/Icon.svelte';

  let {
    title,
    count = null,
    open = false,
    children,
  }: {
    title: string;
    count?: number | null;
    open?: boolean;
    children: Snippet;
  } = $props();

  let isOpen = $state(open);

  function toggle(): void {
    isOpen = !isOpen;
  }
</script>

<div class="pacc" class:open={isOpen}>
  <button class="pacc-head" onclick={toggle} aria-expanded={isOpen}>
    <Icon name="chevron-down" size={14}/>
    <span class="pacc-title">{title}</span>
    {#if count !== null}
      <span class="pacc-count">{count}</span>
    {/if}
  </button>
  <div class="pacc-body">
    <div class="pacc-inner">
      <div class="pacc-pad">
        {@render children()}
      </div>
    </div>
  </div>
</div>

<style>
  .pacc {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-surface);
  }
  .pacc-head {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    border: none;
    background: var(--bg-surface-hover-no-override);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .pacc-head:hover { background: var(--bg-surface-active); }

  .pacc-title {
    flex: 1;
    min-width: 0;
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pacc-count {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-surface-active);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-weight: 600;
    flex-shrink: 0;
  }
  /* плавное раскрытие без JS-высот: grid-rows 0fr→1fr */
  .pacc-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--transition-normal);
  }
  .pacc.open .pacc-body { grid-template-rows: 1fr; }
  .pacc-inner { overflow: hidden; min-height: 0; }
  .pacc-pad {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm) var(--space-sm);
  }
</style>