<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { FleetFilterMode, FleetTagCount } from '../../core/fleet-filter.ts';

  import Icon from '../../../../plugins/shared/icons/Icon.svelte';

  let {
    i18n,
    tags,
    activeTagIds,
    mode,
    onToggleTag,
    onModeChange,
  }: {
    i18n: HostI18n;
    tags: FleetTagCount[];
    activeTagIds: ReadonlySet<string>;
    mode: FleetFilterMode;
    onToggleTag: (id: string) => void;
    onModeChange: (mode: FleetFilterMode) => void;
  } = $props();

  let open = $state(false);
  let placed = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let popoverEl = $state<HTMLDivElement | null>(null);
  let position = $state({ top: 0, inlineStart: 0 });

  /** Keeps the fixed popover inside the viewport in both text directions. */
  function place(): void {
    if (!triggerEl || !popoverEl) return;
    const anchor = triggerEl.getBoundingClientRect();
    const width = popoverEl.offsetWidth;
    const height = popoverEl.offsetHeight;
    const rtl = getComputedStyle(triggerEl).direction === 'rtl';
    const preferredLeft = rtl ? anchor.left : anchor.right - width;
    const left = Math.max(8, Math.min(preferredLeft, window.innerWidth - width - 8));
    const below = anchor.bottom + 6;
    const above = anchor.top - height - 6;
    const top = below + height <= window.innerHeight - 8 || above < 8 ? below : above;
    position = {
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
      inlineStart: rtl ? window.innerWidth - left - width : left,
    };
    placed = true;
  }

  /** Escape must close this popover before the fleet drawer handles the same key. */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    open = false;
    triggerEl?.focus();
  }

  /** Outside interactions dismiss the popover without stealing the target's focus. */
  function outside(target: EventTarget | null): void {
    if (target instanceof Node && (triggerEl?.contains(target) || popoverEl?.contains(target))) return;
    open = false;
  }

  $effect(() => {
    if (!open || !popoverEl) return;
    place();
    popoverEl.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    const onPointerDown = (event: PointerEvent) => outside(event.target);
    const onFocusIn = (event: FocusEvent) => outside(event.target);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', onKeydown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', onKeydown, true);
    };
  });
</script>

<button
  class="filter-trigger"
  class:active={activeTagIds.size > 0}
  bind:this={triggerEl}
  onclick={() => {
    placed = false;
    open = !open;
  }}
  title={i18n.t('fleet.filters')}
  aria-label={i18n.t('fleet.filters')}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls="fleet-filter-popover"
>
  <Icon name="filter" size={16} />
  <span class="trigger-label">{i18n.t('fleet.filters')}</span>
  {#if activeTagIds.size > 0}
    <span class="selected-count">{activeTagIds.size}</span>
  {/if}
</button>

{#if open}
  <div
    id="fleet-filter-popover"
    class="filter-popover"
    class:placed
    bind:this={popoverEl}
    style:top="{position.top}px"
    style:inset-inline-start="{position.inlineStart}px"
    role="dialog"
    aria-label={i18n.t('fleet.filters')}
  >
    <fieldset class="mode-group">
      <legend>{i18n.t('fleet.filterMode')}</legend>
      <label class="mode-choice" class:chosen={mode === 'or'}>
        <input type="radio" name="fleet-filter-mode" value="or" checked={mode === 'or'} onchange={() => onModeChange('or')} />
        <span>{i18n.t('fleet.filterModeAny')}</span>
      </label>
      <label class="mode-choice" class:chosen={mode === 'and'}>
        <input type="radio" name="fleet-filter-mode" value="and" checked={mode === 'and'} onchange={() => onModeChange('and')} />
        <span>{i18n.t('fleet.filterModeAll')}</span>
      </label>
    </fieldset>
    <div class="tag-list" role="group" aria-label={i18n.t('fleet.filters')}>
      {#each tags as { tag, count } (tag.id)}
        <label class="tag-row">
          <input type="checkbox" checked={activeTagIds.has(tag.id)} onchange={() => onToggleTag(tag.id)} />
          {#if tag.icon}<span class="tag-icon" aria-hidden="true"><Icon name={tag.icon} size={16} /></span>{/if}
          <span class="tag-label">{i18n.t(tag.labelKey)}</span>
          <span class="tag-count">{count}</span>
        </label>
      {/each}
    </div>
  </div>
{/if}

<style>
  .filter-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    /* Match the neighboring header actions; the popover choices keep larger touch targets. */
    min-height: 36px;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .filter-trigger:hover, .filter-trigger.active {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--bg-surface-hover);
  }
  .filter-trigger:focus-visible, .mode-choice:focus-within, .tag-row:focus-within {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }
  .selected-count, .tag-count {
    min-width: 20px;
    padding-inline: 5px;
    border-radius: 999px;
    background: var(--bg-surface-hover);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .filter-popover {
    position: fixed;
    z-index: 210;
    width: min(320px, calc(100vw - 16px));
    max-height: min(440px, calc(100dvh - 16px));
    overflow-y: auto;
    padding: var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    box-shadow: var(--shadow-lg);
    visibility: hidden;
  }
  .filter-popover.placed { visibility: visible; }
  .mode-group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    min-width: 0;
    margin: 0 0 var(--space-sm);
    padding: 0 0 var(--space-sm);
    border: 0;
    border-bottom: 1px solid var(--border-color);
  }
  .mode-group legend {
    margin-bottom: var(--space-xs);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .mode-choice {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-height: 44px;
    padding-inline: var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .mode-choice.chosen { border-color: var(--accent); color: var(--text-primary); }
  .tag-list { display: grid; gap: 2px; }
  .tag-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-height: 44px;
    min-width: 0;
    padding-inline: var(--space-xs);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .tag-row:hover { background: var(--bg-surface-hover); }
  .tag-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .tag-icon { display: flex; flex-shrink: 0; color: var(--text-secondary); }
  .tag-count { flex-shrink: 0; }

  /* Keep the label compact while the fixed popover can still use the full viewport. */
  @media (max-width: 768px) {
    .filter-trigger { min-width: 36px; }
    .trigger-label { display: none; }
  }
</style>
