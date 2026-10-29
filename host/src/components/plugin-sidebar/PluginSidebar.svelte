<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { Router, Route } from '../../core/router.svelte.ts';
  import type { SettingsStore } from '../../core/settings-store.svelte.ts';
  import Icon from '../icons/Icon.svelte';
  import RawIcon from '../icons/RawIcon.svelte';

  let {
    registry,
    settings,
    printerId,
    i18n,
    router,
    route,
    collapsed,
  }: {
    registry: PluginRegistry;
    settings: SettingsStore;
    printerId: string;
    i18n: HostI18n;
    router: Router;
    route: Route;
    collapsed: boolean;
  } = $props();

  let visiblePages = $derived(registry.getVisiblePages(printerId));
</script>

{#each visiblePages as page (page.contribution.id)}
  {@const isActive = route.kind === 'plugin-page' && route.pageId === page.contribution.id}

  <button
    class="nav-item"
    class:active={isActive}
    class:collapsed
    onclick={() => router.navigateToPluginPage(printerId, page.contribution.id)}
    title={collapsed ? i18n.t(page.contribution.titleKey) : undefined}
  >
    <span class="nav-icon">
      {#if page.contribution.iconSvg}
        <RawIcon raw={page.contribution.iconSvg} />
      {:else}
        <Icon name={page.contribution.icon ?? 'file'} />
      {/if}
    </span>
    {#if !collapsed}
      <span class="nav-label">{i18n.t(page.contribution.titleKey)}</span>
    {/if}
  </button>
{/each}

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

  .nav-item.active {
    background: var(--bg-surface-active);
    color: var(--accent);
  }

  .nav-item.collapsed {
    justify-content: center;
    padding-inline: 0;
    gap: 0;
  }

  .nav-icon {
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

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>