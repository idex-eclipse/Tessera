<script lang="ts">
  let {
    open,
    title,
    label = '',
    initial = '',
    confirmLabel,
    onSubmit,
    onClose,
  }: {
    open: boolean;
    title: string;
    label?: string;
    initial?: string;
    confirmLabel: string;
    onSubmit: (value: string) => void;
    onClose: () => void;
  } = $props();

  let value = $state('');

  $effect(() => {
    if (open) value = initial;
  });

  function submit(): void {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    onClose();
  }
</script>

{#if open}
  <div class="dialog-backdrop" onclick={onClose} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true">
    <div class="dialog-header"><h3>{title}</h3></div>
    <div class="dialog-body">
      {#if label}<span class="dialog-label">{label}</span>{/if}
      <input bind:value onkeydown={(e) => e.key === 'Enter' && submit()} />
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
      <button class="btn btn-primary" disabled={!value.trim()} onclick={submit}>{confirmLabel}</button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); z-index: 300; }
  .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 420px; background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 301; overflow: hidden; }
  .dialog-header { padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color); }
  .dialog-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
  .dialog-body { padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-sm); }
  .dialog-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .dialog-body input { padding: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); font-size: var(--font-size-md); }
  .dialog-body input:focus { outline: none; border-color: var(--border-focus); }
  .dialog-footer { display: flex; justify-content: flex-end; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border-color); }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
</style>