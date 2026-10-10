<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { Router, Route } from '../../core/router.svelte.ts';
  import type { SettingsStore } from '../../core/settings-store.svelte.ts';

  import Icon from '../icons/Icon.svelte';
  import PluginSidebar from '../plugin-sidebar/PluginSidebar.svelte';

  let {
    registry,
    settings,
    printerManager,
    router,
    i18n,
    route,
    collapsed,
    onToggleCollapse,
  }: {
    registry: PluginRegistry;
    settings: SettingsStore;
    printerManager: PrinterManager;
    router: Router;
    i18n: HostI18n;
    route: Route;
    collapsed: boolean;
    onToggleCollapse: () => void;
  } = $props();

  let activePrinterId = $derived(printerManager.activePrinterId);
</script>

<aside class="sidebar" class:collapsed>
  <nav class="sidebar-nav">
    <button
      class="nav-item"
      class:active={route.kind === 'dashboard'}
      onclick={() => router.navigateToActiveDashboard()}
    >
      <span class="nav-icon"><Icon name="dashboard" /></span>
      {#if !collapsed}
        <span class="nav-label">{i18n.t('nav.dashboard')}</span>
      {/if}
    </button>

    {#if activePrinterId}
      <PluginSidebar
        {registry}
        {settings}
        printerId={activePrinterId}
        {i18n}
        {router}
        {route}
        {collapsed}
      />
    {/if}

    <button
      class="nav-item nav-item-settings"
      class:active={route.kind === 'settings'}
      onclick={() => router.navigateToSettings()}
    >
      <span class="nav-icon"><Icon name="settings" /></span>
      {#if !collapsed}
        <span class="nav-label">{i18n.t('nav.settings')}</span>
      {/if}
    </button>

    <button class="nav-item" onclick={onToggleCollapse} title={i18n.t('nav.collapse')}>
      <span class="nav-icon">
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
      </span>
      {#if !collapsed}
        <span class="nav-label">{i18n.t('nav.collapse')}</span>
      {/if}
    </button>
  </nav>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: var(--sidebar-w);
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
    transition: width var(--transition-normal);
  }

  .sidebar.collapsed {
    width: var(--sidebar-w);
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    padding: var(--space-sm);
    flex: 1;
  }

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
    text-align: left;
    width: 100%;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .sidebar.collapsed .nav-item {
    justify-content: center;
    padding: var(--space-sm);
  }

  .nav-item:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--bg-surface-active);
    color: var(--accent);
  }

  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-item-settings {
    margin-top: auto;
  }
</style>