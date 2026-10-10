<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { confirm } from '../../components/confirm/confirm-dialog.svelte.ts';
  import ConnectionStatus from '../../components/connection-status/ConnectionStatus.svelte';
  import { openAddPrinter } from './add-printer-dialog-store.svelte';
  import EditPrinterDialog from './edit-printer-dialog.svelte';
  import type { PrinterRecord } from '../../core/settings-store.svelte.ts';

  let editing = $state<PrinterRecord | null>(null);

  const { printerManager, i18n } = getAppContext();

  let printers = $derived(printerManager.printers);

  function setActive(id: string): void {
    printerManager.setActivePrinter(id);
  }

  async function handleRemove(id: string, name: string): Promise<void> {
    const ok = await confirm({
      title: i18n.t('settings.printers'),
      message: `${i18n.t('common.remove')}: ${name}?`,
      danger: true,
    });
    if (!ok) return;
    printerManager.removePrinter(id);
  }
</script>

<div class="section">
  <div class="printer-list">
    {#each printers as p (p.id)}
      {@const conn = printerManager.getConnection(p.id)}
      <div class="printer-row" class:active={printerManager.activePrinterId === p.id}>
        <button class="printer-main" onclick={() => setActive(p.id)}>
          {#if conn}<ConnectionStatus status={conn.status} />{/if}
          <span class="printer-name">{p.name}</span>
          <span class="printer-url">{p.url}</span>
        </button>
        <div class="printer-actions">
          <button class="btn btn-secondary" onclick={() => (editing = p)}>
            {i18n.t('common.edit')}
          </button>
          <button class="btn btn-danger" onclick={() => handleRemove(p.id, p.name)}>
            {i18n.t('common.remove')}
          </button>
        </div>
      </div>
    {:else}
      <p class="empty">{i18n.t('printer.noPrinters')}</p>
    {/each}
  </div>

  <div class="section-add">
    <button class="btn btn-primary" onclick={openAddPrinter}>
      + {i18n.t('settings.addPrinterTitle')}
    </button>
  </div>

  <EditPrinterDialog printer={editing} onClose={() => (editing = null)} />
</div>

<style>
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.section-add {
  display: flex;
  justify-content: center;
  padding-top: var(--space-sm);
}

  .printer-list { display: flex; flex-direction: column; gap: var(--space-sm); }
  .printer-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
  .printer-row.active { border-color: var(--accent); }
  .printer-main { display: flex; align-items: center; gap: var(--space-sm); border: none; background: transparent; cursor: pointer; color: var(--text-primary); flex: 1; text-align: left; }
  .printer-name { font-weight: 600; }
  .printer-url { color: var(--text-muted); font-size: var(--font-size-sm); font-family: monospace; }
  .printer-actions { display: flex; gap: var(--space-sm); }
  .empty { color: var(--text-muted); }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
  .btn-danger { background: var(--danger); color: #fff; }
</style>