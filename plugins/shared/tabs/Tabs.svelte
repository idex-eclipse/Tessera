<script lang="ts" module>
  export interface TabItem {
    id: string;
    label: string;
    /** точка-индикатор справа от названия */
    badge?: 'warn' | 'crit' | null;
    /** текст для скринридера, когда есть индикатор */
    badgeLabel?: string;
  }

  let uid = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  import { isRtl } from '../popover-align';

  let {
    tabs,
    active,
    onSelect,
    label,
    trailing,
    children,
  }: {
    tabs: TabItem[];
    active: string;
    onSelect: (id: string) => void;
    /** aria-label для tablist */
    label?: string;
    /** содержимое в конце ряда вкладок (индикаторы, кнопки) */
    trailing?: Snippet;
    /** содержимое активной вкладки */
    children: Snippet;
  } = $props();

  const base = `tabs-${++uid}`;
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  let listEl = $state<HTMLDivElement | null>(null);

  function focusTab(id: string): void {
    listEl?.querySelector<HTMLButtonElement>(`[data-tab="${CSS.escape(id)}"]`)?.focus();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0 || tabs.length === 0) return;

    // в RTL ряд вкладок зеркален: «вперёд» — это ArrowLeft
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const back = isRtl() ? 'ArrowRight' : 'ArrowLeft';

    let next = -1;
    if (e.key === forward) next = (i + 1) % tabs.length;
    else if (e.key === back) next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;

    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onSelect(target.id);
    focusTab(target.id);
  }
</script>

<div class="tabrow">
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="tabs"
    role="tablist"
    aria-label={label}
    bind:this={listEl}
    onkeydown={onKeydown}
  >
    {#each tabs as t (t.id)}
      <button
        type="button"
        class="tab"
        class:active={t.id === active}
        role="tab"
        id={tabId(t.id)}
        data-tab={t.id}
        aria-selected={t.id === active}
        aria-controls={panelId}
        tabindex={t.id === active ? 0 : -1}
        onclick={() => onSelect(t.id)}
      >
        <span class="tab-label">{t.label}</span>
        {#if t.badge}
          <span class="badge {t.badge}" aria-hidden="true"></span>
          {#if t.badgeLabel}<span class="sr-only">{t.badgeLabel}</span>{/if}
        {/if}
      </button>
    {/each}
  </div>
  {@render trailing?.()}
</div>

<div class="tabpanel" role="tabpanel" id={panelId} aria-labelledby={tabId(active)}>
  {@render children()}
</div>

<style>
  /* геометрия ряда — как у вкладок Calibrations */
  .tabrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm) 0;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .tabs {
    display: flex;
    gap: 2px;
    flex: 1 1 220px;
    min-width: 0;
    overflow-x: auto;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .tab:hover {
    background: var(--bg-surface-hover);
  }

  .tab.active {
    background: var(--bg-surface-active);
    color: var(--accent);
    font-weight: 600;
  }

  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .badge {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .badge.warn {
    background: var(--warning);
  }

  .badge.crit {
    background: var(--danger);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .tabpanel {
    min-width: 0;
  }
</style>
