<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { isPluginSynced, setPluginSynced } from '../../core/settings-sync.svelte';

  const { registry, printerManager, i18n } = getAppContext();

  let printers = $derived(printerManager.printers);
  let selected = $state('');
  let printerId = $derived(
    selected !== '' ? selected : printerManager.activePrinterId,
  );

  let pages = $derived(registry.getPages());
  let visibleIds = $derived(
    printerId
      ? new Set(registry.getVisiblePages(printerId).map((p) => p.contribution.id))
      : new Set<string>(),
  );

  function toggle(pageId: string): void {
    if (!printerId) return;
    registry.setPageVisibility(printerId, pageId, !visibleIds.has(pageId));
  }
</script>

<div class="section">
  <div class="section-actions">
    <label class="printer-select">
      <span>{i18n.t('settings.printer')}</span>
      <select bind:value={selected}>
        <option value="">{i18n.t('settings.printerActive')}</option>
        {#each printers as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </label>
  </div>

  <p class="hint">{i18n.t('settings.pagesHint')}</p>

  {#if !printerId}
    <p class="empty">{i18n.t('printer.noPrinters')}</p>
  {:else}
    <div class="page-list">
      {#each pages as page (page.contribution.id)}
        <label class="page-row">
          <input
            type="checkbox"
            checked={visibleIds.has(page.contribution.id)}
            onchange={() => toggle(page.contribution.id)}
          />
          <span class="page-name">{i18n.t(page.contribution.titleKey)}</span>
          <span class="page-meta">{page.pluginId}</span>
        </label>
      {:else}
        <p class="empty">—</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .section { display: flex; flex-direction: column; gap: var(--space-md); }
  .section-actions { display: flex; align-items: center; gap: var(--space-md); }
  .printer-select { display: flex; align-items: center; gap: var(--space-sm); color: var(--text-secondary); font-size: var(--font-size-sm); }
  .printer-select select { padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); }
  .hint { color: var(--text-muted); font-size: var(--font-size-sm); }
  .empty { color: var(--text-muted); }
  .page-list { display: flex; flex-direction: column; gap: var(--space-xs); }
  .page-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor: pointer; }
  .page-row:hover { background: var(--bg-surface-hover); }
  .page-name { font-weight: 500; }
  .page-meta { margin-inline-start: auto; color: var(--text-muted); font-size: var(--font-size-sm); font-family: monospace; }
</style>