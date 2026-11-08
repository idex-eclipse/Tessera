<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  let { open, name, busy, notice, onRestart, onClose }: {
    open: boolean;
    name: string;
    busy: boolean;
    notice: string;
    onRestart: () => void;
    onClose: () => void;
  } = $props();

  const i18n = usePluginApi().i18n;
  let dialog: HTMLDialogElement;
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<!-- A native modal stays above the file table; explicit centering avoids UA-style drift. -->
<dialog bind:this={dialog} aria-labelledby="config-restore-title" oncancel={(event) => { event.preventDefault(); onClose(); }}>
  <div class="backup-dialog">
    <header>
      <h2 id="config-restore-title">{i18n.t('config.restoreTitle', { name })}</h2>
      <button type="button" class="action" onclick={onClose} aria-label={i18n.t('ft.close')}>{i18n.t('ft.close')}</button>
    </header>
    <p role="status">{i18n.t('config.backupRestored')}</p>
    {#if notice}<p class="warning" role="alert">{notice}</p>{/if}
    <footer>
      <button type="button" class="action" onclick={onClose}>{i18n.t('ft.close')}</button>
      <button type="button" class="action primary" disabled={busy} onclick={onRestart}>{i18n.t('config.restartRestored')}</button>
    </footer>
  </div>
</dialog>

<style>
  dialog { position: fixed; inset: 0; margin: auto; width: min(92vw, 500px); height: fit-content; max-height: 88vh; padding: 0; border: 1px solid var(--border-color); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); }
  dialog::backdrop { background: var(--bg-overlay); }
  .backup-dialog { display: flex; flex-direction: column; max-height: 88vh; min-width: 0; }
  header, footer { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); padding: var(--space-md); }
  header { border-block-end: 1px solid var(--border-color); }
  header h2 { flex: 1; min-width: 0; margin: 0; font-size: var(--font-size-lg); overflow-wrap: anywhere; }
  p { padding-inline: var(--space-md); margin-block: var(--space-sm); color: var(--text-secondary); }
  p.warning { color: var(--danger); overflow-wrap: anywhere; }
  footer { justify-content: flex-end; border-block-start: 1px solid var(--border-color); }
  .action { min-height: 44px; padding-inline: var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface-hover); color: var(--text-primary); cursor: pointer; }
  .action.primary { background: var(--accent); border-color: var(--accent); color: var(--bg-surface); }
  /* Wrapped actions keep the prompt usable at narrow widths and in RTL. */
  @media (max-width: 768px) { dialog { width: 96vw; } footer .action { flex: 1; } }
</style>
