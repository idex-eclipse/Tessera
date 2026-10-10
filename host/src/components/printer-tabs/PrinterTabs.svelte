<script lang="ts">
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { Router } from '../../core/router.svelte.ts';

  import ConnectionStatus from '../connection-status/ConnectionStatus.svelte';

  import { openAddPrinter } from '../../pages/settings/add-printer-dialog-store.svelte';

  let {
    printerManager,
    router,
  }: {
    printerManager: PrinterManager;
    router: Router;
  } = $props();

  let printers = $derived(printerManager.printers);
  let activePrinterId = $derived(printerManager.activePrinterId);

  function handleTabClick(printerId: string) {
    router.navigateToPrinter(printerId);
  }
</script>

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

<style>
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
</style>