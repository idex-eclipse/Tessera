<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { UiStore } from '../../core/ui-store.svelte.ts';

  import { getAppContext } from '../../app-context.ts';
  import { createPluginApi } from '../../core/plugin-api-factory.ts';

  import Icon from '../../../../plugins/shared/icons/Icon.svelte';
  import ConnectionStatus from '../connection-status/ConnectionStatus.svelte';
  import PluginElementHost from '../plugin-element-host.svelte';

  import type { Router } from '../../core/router.svelte.ts';

  let {
    printerManager,
    registry,
    ui,
    i18n,
    router,
  }: {
    printerManager: PrinterManager;
    registry: PluginRegistry;
    ui: UiStore;
    i18n: HostI18n;
    router: Router;
  } = $props();

  /** Стабильный объект params на принтер: идентичность не меняется между
   *  рендерами, поэтому ре-инъекция свойств не дёргает CE-панели. */
  const paramsCache = new Map<string, Record<string, string>>();

  const ctx = getAppContext();

  let printers = $derived(printerManager.printers);
  let activePrinterId = $derived(printerManager.activePrinterId);
  let panels = $derived(registry.getPrinterPanels());

  /** Кэш PluginApi по pluginId, чтобы не пересоздавать на каждый рендер */
  const apiCache = new Map<string, PluginApi>();
  function apiFor(pluginId: string): PluginApi | null {
    const cached = apiCache.get(pluginId);
    if (cached) return cached;
    const loaded = ctx.loader.getLoadedPlugin(pluginId);
    if (!loaded) return null;
    const api = createPluginApi(ctx, pluginId, loaded.manifest);
    apiCache.set(pluginId, api);
    return api;
  }

  function handleClose() {
    ui.setFleet(false);
  }

  function handleActivate(printerId: string) {
    router.navigateToPrinter(printerId);   // баг 2: навигация на страницу принтера
    ui.setFleet(false);                    // и закрытие панели
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  function paramsFor(printerId: string): Record<string, string> {
    let p = paramsCache.get(printerId);
    if (!p) {
      p = { printerId };
      paramsCache.set(printerId, p);
    }
    return p;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fleet-drawer">
  <div class="fleet-header">
    <h2 class="fleet-title">{i18n.t('fleet.title')}</h2>
    <button class="fleet-close" onclick={handleClose} aria-label={i18n.t('fleet.close')}>
      <Icon name="x" />
    </button>
  </div>

  {#if printers.length === 0}
    <div class="fleet-empty">
      <p>{i18n.t('fleet.empty')}</p>
    </div>
  {:else}
    <div class="fleet-grid">
      {#each printers as printer (printer.id)}
        {@const connection = printerManager.getConnection(printer.id)}
        {@const isActive = printer.id === activePrinterId}

        <div class="fleet-card" class:active={isActive}>
          <div 
            class="fleet-card-header"
            onclick={() => handleActivate(printer.id)}
          >
            <div class="fleet-card-info">
              <span class="fleet-card-name">{printer.name}</span>
              {#if connection}
                <ConnectionStatus status={connection.status} />
              {/if}
            </div>
          </div>

          <div class="fleet-card-body">
            {#if panels.length === 0}
              <p class="fleet-card-empty">{i18n.t('fleet.noPanels')}</p>
            {:else}
              {#each panels as panel (panel.pluginId + ':' + panel.contribution.id)}
                {@const api = apiFor(panel.pluginId)}
                {#if api}
                  <PluginElementHost
                    tag={panel.contribution.element}
                    {api}
                    params={paramsFor(printer.id)}
                    fill={false}
                  />
                {:else}
                  <div class="fleet-card-missing">
                    {i18n.t('fleet.pluginMissing')} · {panel.pluginId}
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .fleet-drawer {
    position: fixed;
    top: var(--header-height);
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
    background: var(--bg-surface);
    border-top: 2px solid var(--border-color);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    animation: slideDown 0.25s ease-out;
  }

  @keyframes slideDown {
    from {
      transform: translateY(-100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .fleet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) var(--space-md);
    border-color: var(--border-color);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .fleet-title {
    font-size: var(--font-size-xl);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .fleet-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .fleet-close:hover {
    background: var(--bg-surface-hover);
  }

  .fleet-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-secondary);
    font-size: var(--font-size-lg);
  }

  .fleet-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    grid-auto-rows: var(--grid-row-height, 80px);
    gap: var(--space-md);
    padding: var(--space-lg);
    overflow-y: auto;
    flex: 1;
  }

  @media (max-width: 768px) {
    .fleet-grid {
      grid-template-columns: 1fr;
    }
  }

  .fleet-card {
    grid-column: span 4;
    grid-row: span 5;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-fast);
  }

  .fleet-card.active {
    border-color: var(--accent);
  }

  .fleet-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-surface-hover);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    cursor: pointer;
  }

  .fleet-card-info {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-width: 0;
    flex: 1;
  }

  .fleet-card-name {
    font-weight: 600;
    font-size: var(--font-size-md);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fleet-card-body {
    flex: 1;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-height: 0;
    overflow-y: auto;
  }

  .fleet-card-empty {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
  }

  .fleet-card-missing {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: monospace;
    padding: var(--space-sm);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
  }
</style>