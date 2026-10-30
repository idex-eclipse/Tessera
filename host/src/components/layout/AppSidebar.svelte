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
    narrow = false,
    open = false,
    onClose = () => {},
  }: {
    registry: PluginRegistry;
    settings: SettingsStore;
    printerManager: PrinterManager;
    router: Router;
    i18n: HostI18n;
    route: Route;
    collapsed: boolean;
    onToggleCollapse: () => void;
    /** Узкий экран: сайдбар становится оверлеем на всю ширину. */
    narrow?: boolean;
    /** Только для narrow: панель открыта. */
    open?: boolean;
    onClose?: () => void;
  } = $props();

  let activePrinterId = $derived(printerManager.activePrinterId);

  // В drawer-режиме сохранённое «свёрнуто» игнорируется: панель всегда полная.
  let isCollapsed = $derived(collapsed && !narrow);

  let closeBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (narrow && open) closeBtn?.focus();
  });

  /** Любой переход из drawer закрывает его — в том числе клик по уже активной странице. */
  function onNavClick(event: MouseEvent) {
    if (!narrow) return;
    if ((event.target as HTMLElement).closest('button, a')) onClose();
  }
</script>

{#if !narrow || open}
  <aside
    class="sidebar"
    class:collapsed={isCollapsed}
    class:drawer={narrow}
    aria-label={narrow ? i18n.t('nav.menu') : undefined}
  >
    {#if narrow}
      <header class="drawer-header">
        <span class="drawer-title">{i18n.t('nav.menu')}</span>
        <button
          class="drawer-close"
          bind:this={closeBtn}
          onclick={onClose}
          aria-label={i18n.t('common.close')}
        >
          <Icon name="x" />
        </button>
      </header>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <nav class="sidebar-nav" onclick={onNavClick}>
      <button
        class="nav-item"
        class:active={route.kind === 'dashboard'}
        onclick={() => router.navigateToActiveDashboard()}
      >
        <span class="nav-icon"><Icon name="dashboard" /></span>
        {#if !isCollapsed}
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
          collapsed={isCollapsed}
        />
      {/if}

      <button
        class="nav-item nav-item-settings"
        class:active={route.kind === 'settings'}
        onclick={() => router.navigateToSettings()}
      >
        <span class="nav-icon"><Icon name="settings" /></span>
        {#if !isCollapsed}
          <span class="nav-label">{i18n.t('nav.settings')}</span>
        {/if}
      </button>

      {#if !narrow}
        <button class="nav-item" onclick={onToggleCollapse} title={i18n.t('nav.collapse')}>
          <span class="nav-icon">
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} flip />
          </span>
          {#if !isCollapsed}
            <span class="nav-label">{i18n.t('nav.collapse')}</span>
          {/if}
        </button>
      {/if}
    </nav>
  </aside>
{/if}

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: var(--sidebar-w);
    background: var(--bg-sidebar);
    border-inline-end: 1px solid var(--border-color);
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
    transition: width var(--transition-normal);
  }

  .sidebar.collapsed {
    width: var(--sidebar-w);
  }

  /* Узкий экран: оверлей на всю ширину под шапкой */
  .sidebar.drawer {
    position: fixed;
    inset-block: var(--header-height) 0;
    inset-inline: 0;
    width: auto;
    border-inline-end: none;
    z-index: var(--z-drawer);
    transition: none;
    animation: drawer-in-start 200ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar.drawer {
      animation: none;
    }
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .drawer-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .drawer-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target);
    height: var(--touch-target);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .drawer-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
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
    text-align: start;
    width: 100%;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .sidebar.drawer .nav-item {
    min-height: var(--touch-target);
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
