<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';
  import type { ConfigDiffLine } from './config-diff';

  let { open, name, lines, busy, restored, notice, onRestore, onRestart, onClose }: {
    open: boolean;
    name: string;
    lines: ConfigDiffLine[];
    busy: boolean;
    restored: boolean;
    notice: string;
    onRestore: () => void;
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

<!-- The top layer keeps the comparison usable inside the clipped file-table card. -->
<dialog bind:this={dialog} onclose={onClose}>
  <div class="backup-dialog">
    <header>
      <h2>{i18n.t('config.backupDiffTitle', { name })}</h2>
      <button class="action" onclick={onClose} aria-label={i18n.t('ft.close')}>{i18n.t('ft.close')}</button>
    </header>
    {#if !restored}
      <p>{i18n.t('config.backupDiffHint')}</p>
      <div class="diff" dir="ltr" aria-label={i18n.t('config.backupDiffTitle', { name })}>
        {#each lines as line, index (index)}
          <div class="line" class:added={line.kind === 'added'} class:removed={line.kind === 'removed'}>
            <span class="marker">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>
            <span>{line.text || ' '}</span>
          </div>
        {/each}
      </div>
    {/if}
    {#if notice}<p class="warning" role="alert">{notice}</p>{/if}
    <footer>
      {#if restored}
        <span role="status">{i18n.t('config.backupRestored')}</span>
        <button class="action primary" disabled={busy} onclick={onRestart}>{i18n.t('config.restartRestored')}</button>
      {:else}
        <button class="action primary" disabled={busy} onclick={onRestore}>{i18n.t('config.restoreBackup')}</button>
      {/if}
    </footer>
  </div>
</dialog>

<style>
  dialog { width: min(92vw, 900px); max-height: 88vh; padding: 0; border: 1px solid var(--border-color); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); }
  dialog::backdrop { background: var(--bg-overlay); }
  .backup-dialog { display: flex; flex-direction: column; max-height: 88vh; min-width: 0; }
  header, footer { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); padding: var(--space-md); }
  header { border-block-end: 1px solid var(--border-color); }
  header h2 { flex: 1; min-width: 0; margin: 0; font-size: var(--font-size-lg); overflow-wrap: anywhere; }
  p { padding-inline: var(--space-md); margin-block: var(--space-sm); color: var(--text-secondary); }
  p.warning { color: var(--danger); overflow-wrap: anywhere; }
  .diff { overflow: auto; flex: 1; min-height: 8rem; margin-inline: var(--space-md); border: 1px solid var(--border-color); font-family: monospace; font-size: var(--font-size-sm); }
  .line { display: flex; white-space: pre; min-width: max-content; }
  .line.added { background: color-mix(in srgb, var(--success) 15%, var(--bg-surface)); }
  .line.removed { background: color-mix(in srgb, var(--danger) 15%, var(--bg-surface)); }
  .marker { width: 2ch; flex: none; text-align: center; user-select: none; }
  footer { justify-content: flex-end; border-block-start: 1px solid var(--border-color); }
  .action { min-height: 44px; padding-inline: var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface-hover); color: var(--text-primary); cursor: pointer; }
  .action.primary { background: var(--accent); color: var(--bg-surface); }
  /* Wrapped actions and a scrollable diff keep the dialog usable at narrow widths and in RTL. */
  @media (max-width: 768px) { dialog { width: 96vw; } footer .action { flex: 1; } }
</style>
