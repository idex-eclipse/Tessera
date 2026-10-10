<script lang="ts">
  let {
    open,
    title,
    message,
    confirmLabel,
    danger = false,
    onConfirm,
    onClose,
  }: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
    onClose: () => void;
  } = $props();
</script>

{#if open}
  <div class="dialog-backdrop" onclick={onClose} role="presentation"></div>
  <div class="dialog" role="alertdialog" aria-modal="true">
    <div class="dialog-header"><h3>{title}</h3></div>
    <div class="dialog-body"><p class="dialog-message">{message}</p></div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
      <button class="btn" class:danger onclick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); z-index: 300; }
  .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 420px; background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 301; overflow: hidden; }
  .dialog-header { padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color); }
  .dialog-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
  .dialog-body { padding: var(--space-lg); }
  .dialog-message { color: var(--text-secondary); line-height: 1.5; }
  .dialog-footer { display: flex; justify-content: flex-end; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border-color); }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
  .btn.danger { background: var(--danger); color: #fff; }
</style>