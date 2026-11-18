<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { configRestartMonitor } from '../../../shared/file-table/config-restart-monitor';
  import { restoreConfigAttempt } from '../../../shared/file-table/config-restart-recovery';
  import { pageHash } from '../../../shared/page-nav';

  let { params = {} }: { params?: Record<string, string> } = $props();
  const api = usePluginApi();
  let available = $state(false);
  let busy = $state(false);
  let dialog: HTMLDialogElement;
  let dialogKind = $state<'conflict' | 'error'>('conflict');
  let detail = $state('');
  let fileCount = $state(1);

  $effect(() => {
    const { printerId, attemptId } = params;
    if (!printerId || !attemptId) return;
    const monitor = configRestartMonitor(printerId, api.moonrakerFor(printerId));
    return monitor.subscribe((attempt) => {
      available = attempt?.id === attemptId && attempt.phase === 'failed' && Boolean(attempt.backup);
      fileCount = attempt?.files?.length ?? 1;
    });
  });

  /** Use the same backup-first recovery as the Config table, with a visible conflict confirmation. */
  async function restore(overwrite = false): Promise<void> {
    const { printerId, attemptId } = params;
    if (!printerId || !attemptId || busy) return;
    busy = true;
    try {
      const outcome = await restoreConfigAttempt(api, printerId, attemptId, overwrite);
      if (outcome === 'conflict') {
        dialogKind = 'conflict';
        if (!dialog.open) dialog.showModal();
      } else if (outcome === 'restored') {
        if (dialog.open) dialog.close();
        globalThis.location.hash = pageHash(printerId, 'config');
      } else if (outcome === 'unavailable') {
        dialogKind = 'error';
        detail = api.i18n.t('config.restartUnavailable');
        if (!dialog.open) dialog.showModal();
      }
    } catch (error) {
      dialogKind = 'error';
      detail = error instanceof Error ? error.message : String(error);
      if (!dialog.open) dialog.showModal();
    } finally {
      busy = false;
    }
  }
</script>

{#if available}
  <button class="restore-action" disabled={busy} onclick={() => void restore()}>{api.i18n.t(fileCount > 1 ? 'config.restartRollbackActionMany' : 'config.restartRollbackAction')}</button>
{/if}

<dialog bind:this={dialog} class="restore-dialog" aria-label={api.i18n.t(fileCount > 1 ? 'config.restartRestoreMany' : 'config.restartRestore')}>
  <strong>{api.i18n.t(fileCount > 1 ? 'config.restartRestoreMany' : 'config.restartRestore')}</strong>
  {#if dialogKind === 'conflict'}
    <p>{api.i18n.t(fileCount > 1 ? 'config.restartConflictMany' : 'config.restartConflict')}</p>
  {:else}
    <p role="alert">{detail}</p>
  {/if}
  <div class="dialog-actions">
    {#if dialogKind === 'conflict'}
      <button disabled={busy} onclick={() => void restore(true)}>{api.i18n.t('config.restartOverwrite')}</button>
    {/if}
    <button onclick={() => dialog.close()}>{api.i18n.t('config.restartCancel')}</button>
  </div>
</dialog>

<style>
  .restore-action { min-height: 28px; max-inline-size: 150px; padding: 2px var(--space-xs); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface-hover); color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; }
  .restore-action:disabled { opacity: 0.6; cursor: default; }
  /* Native dialog uses the top layer, so the confirmation remains visible above compact toasts. */
  .restore-dialog { inline-size: min(92vw, 440px); padding: var(--space-lg); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); box-shadow: var(--shadow-lg); overflow-wrap: anywhere; }
  .restore-dialog::backdrop { background: var(--bg-overlay); }
  .restore-dialog p { margin-block: var(--space-md); }
  .dialog-actions { display: flex; flex-wrap: wrap; justify-content: end; gap: var(--space-sm); }
  .dialog-actions button { min-height: 40px; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface-hover); color: var(--text-primary); cursor: pointer; }
</style>
