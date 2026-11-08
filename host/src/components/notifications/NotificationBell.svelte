<script lang="ts">
  import { getAppContext } from '../../app-context';
  import Icon from '../icons/Icon.svelte';

  let { collapsed = false }: { collapsed?: boolean } = $props();

  const ctx = getAppContext();
  const center = ctx.notifications;

  let unseen = $derived(center.unseenCount);
  let title = $derived(ctx.i18n.t('notifications.title'));
</script>

<button
  class="nav-item"
  class:collapsed
  onclick={() => center.toggle()}
  aria-expanded={center.open}
  {title}
>
  <span class="nav-icon">
    <Icon name="bell" size={20} />
    {#if unseen > 0}
      <span class="nav-badge">{unseen > 99 ? '99+' : unseen}</span>
    {/if}
  </span>
  {#if !collapsed}
    <span class="nav-label">{title}</span>
  {/if}
</button>

<style>
  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    cursor: pointer;
    text-align: start;
    width: 100%;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .nav-item:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .nav-item.collapsed {
    justify-content: center;
    padding-inline: 0;
    gap: 0;
  }

  .nav-icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
  }

  .nav-icon :global(svg) {
    display: block;
  }

  .nav-badge {
    position: absolute;
    top: -4px;
    inset-inline-end: -6px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--danger);
    color: #fff;
    font-size: var(--font-size-2xs);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
