<script lang="ts">
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { Router } from '../../core/router.svelte.ts';
  import type { UiStore } from '../../core/ui-store.svelte.ts';
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';

  import ConnectionStatus from '../connection-status/ConnectionStatus.svelte';
  import Icon from '../../../../plugins/shared/icons/Icon.svelte';

  import { openAddPrinter } from '../../pages/settings/add-printer-dialog-store.svelte';

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

  let printers = $derived(printerManager.printers);
  let activePrinterId = $derived(printerManager.activePrinterId);

  function handleTabClick(printerId: string) {
    router.navigateToPrinter(printerId);
    ui.setFleet(false)
  }
</script>

<div class="tabs-wrapper">
  <div class="tabs">
    {#each printers as printer (printer.id)}
      {@const connection = printerManager.getConnection(printer.id)}

      <button
        class="tab"
        class:active={printer.id === activePrinterId}
        onclick={() => handleTabClick(printer.id)}
      >
        <span class="tab-name">{printer.name}</span>
        {#if connection}
          <ConnectionStatus status={connection.status} />
        {/if}
      </button>
    {/each}

    <button class="tab tab-add" onclick={openAddPrinter}>
      +
    </button>
  </div>

  {#if !ui.fleetOpen}
    <button
      class="fleet-toggle"
      class:open={ui.fleetOpen}
      onclick={() => ui.toggleFleet()}
      aria-label={i18n.t('fleet.title')}
      title={i18n.t('fleet.title')}
    >
      <Icon name="chevron-down" />
    </button>
  {/if}
</div>

<style>
  .tabs-wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    overflow-x: auto;
    flex: 1;
    min-width: 0;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-on-header-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .tab:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-on-header);
  }

  .tab.active {
    background: rgba(255, 255, 255, 0.15);
    color: var(--text-on-header);
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .tab-add {
    font-size: var(--font-size-lg);
    padding: var(--space-xs) var(--space-sm);
    flex-shrink: 0;
  }

  .fleet-toggle {
    position: absolute;
    bottom: -20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 14px;
    border: 2px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    background: var(--bg-header);
    color: var(--text-on-header-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    z-index: 250;   /* выше .fleet-drawer (200), ниже ConfirmDialog/offline (300+) */
  }

  .fleet-toggle:hover {
    background: var(--bg-surface-hover);
    color: var(--text-on-header);
  }

  /* Открытое состояние: кнопка «пристыкована» к верхней кромке drawer'а */
  .fleet-toggle.open {
    background: var(--bg-base, var(--bg-surface));
    color: var(--text-primary);
    border-color: var(--accent);
  }
</style>