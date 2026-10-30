<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';

  let {
    registry,
    printerId,
    i18n,
    open,
    onClose,
    onAdd,
  }: {
    registry: PluginRegistry;
    printerId: string;
    i18n: HostI18n;
    open: boolean;
    onClose: () => void;
    onAdd: (type: string, provider: string, w: number, h: number) => void;
  } = $props();

  let widgetTypes = $derived(registry.getWidgetTypes());
  let selectedType = $state<string | null>(null);

  let providers = $derived(
    selectedType ? registry.getProvidersForType(selectedType) : []
  );

  let selectedProvider = $state<string | null>(null);

  function selectType(type: string) {
    selectedType = type;
    const provs = registry.getProvidersForType(type);
    selectedProvider = provs.length === 1 ? provs[0]!.contribution.provider : null;
  }

  function selectProvider(provider: string) {
    selectedProvider = provider;
  }

  function handleAdd() {
    if (!selectedType || !selectedProvider) return;

    const widget = providers.find(p => p.contribution.provider === selectedProvider);
    const w = widget?.contribution.defaultSize?.w ?? 4;
    const h = widget?.contribution.defaultSize?.h ?? 3;

    onAdd(selectedType, selectedProvider, w, h);
    handleClose();
  }

  function handleClose() {
    selectedType = null;
    selectedProvider = null;
    onClose();
  }
</script>

{#if open}
  <div class="dialog-backdrop" onclick={handleClose} role="presentation"></div>

  <div class="dialog" role="dialog" aria-label={i18n.t('dashboard.addWidget')}>
    <div class="dialog-header">
      <h3>{i18n.t('dashboard.addWidget')}</h3>
      <button class="dialog-close" onclick={handleClose}>✕</button>
    </div>

    <div class="dialog-body">
      {#if widgetTypes.length === 0}
        <p class="dialog-empty">{i18n.t('dashboard.noWidgets')}</p>
      {:else}
        <div class="widget-type-list">
          {#each widgetTypes as type (type)}
            {@const typeProviders = registry.getProvidersForType(type)}
            {@const firstProvider = typeProviders[0]}

            <button
              class="widget-type-item"
              class:selected={selectedType === type}
              onclick={() => selectType(type)}
            >
              <span class="widget-type-name">
                {firstProvider ? i18n.t(firstProvider.contribution.titleKey) : type}
              </span>
              <span class="widget-type-id">{type}</span>
              {#if typeProviders.length > 1}
                <span class="widget-type-count">{typeProviders.length} providers</span>
              {/if}
            </button>
          {/each}
        </div>

        {#if selectedType && providers.length > 1}
          <div class="provider-selection">
            <h4>{i18n.t('dashboard.provider')}</h4>
            {#each providers as provider (provider.contribution.provider)}
              <label class="provider-option">
                <input
                  type="radio"
                  name="provider"
                  value={provider.contribution.provider}
                  checked={selectedProvider === provider.contribution.provider}
                  onchange={() => selectProvider(provider.contribution.provider)}
                />
                <span>{i18n.t(provider.contribution.titleKey)}</span>
                <span class="provider-id">{provider.contribution.provider}</span>
              </label>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={handleClose}>
        {i18n.t('common.cancel')}
      </button>
      <button
        class="btn btn-primary"
        disabled={!selectedType || !selectedProvider}
        onclick={handleAdd}
      >
        {i18n.t('common.add')}
      </button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    z-index: 200;
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 480px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 201;
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--border-color);
  }

  .dialog-header h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
  }

  .dialog-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--font-size-lg);
    padding: var(--space-xs);
  }

  .dialog-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-lg);
  }

  .dialog-empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-xl);
  }

  .widget-type-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .widget-type-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: transparent;
    cursor: pointer;
    text-align: start;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .widget-type-item:hover {
    background: var(--bg-surface-hover);
  }

  .widget-type-item.selected {
    border-color: var(--accent);
    background: var(--bg-surface-active);
  }

  .widget-type-name {
    font-weight: 600;
    font-size: var(--font-size-md);
  }

  .widget-type-id {
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  .widget-type-count {
    font-size: var(--font-size-sm);
    color: var(--accent);
  }

  .provider-selection {
    margin-top: var(--space-lg);
  }

  .provider-selection h4 {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-sm);
  }

  .provider-option {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) 0;
    cursor: pointer;
    font-size: var(--font-size-md);
  }

  .provider-id {
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    margin-inline-start: auto;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    border-top: 1px solid var(--border-color);
  }

  .btn {
    padding: var(--space-sm) var(--space-lg);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--border-color);
  }
</style>