<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { Router } from '../../core/router.svelte.ts';
  import type { UiStore } from '../../core/ui-store.svelte.ts';

  import Icon from '../icons/Icon.svelte';
  import PrinterTabs from '../printer-tabs/PrinterTabs.svelte';

  let {
    printerManager,
    router,
    ui,
    i18n,
  }: {
    printerManager: PrinterManager;
    router: Router;
    ui: UiStore;
    i18n: HostI18n;
  } = $props();

  function toggleTheme() {
    ui.toggleTheme();
  }

  let localeLabel = $derived(i18n.locale.toUpperCase());
</script>

<header class="header">
  <div class="header-left">
    <PrinterTabs {printerManager} {router} />
  </div>

  <div class="header-right">
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--header-height);
    padding: 0 var(--space-md);
    background: var(--bg-header);
    color: var(--text-on-header);
    flex: 1;
    min-width: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

/*  .header-btn {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-on-header-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .header-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-on-header);
  } */
</style>