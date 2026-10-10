<script lang="ts">
  import { getAppContext } from '../../app-context';
  import {
    getConfirmRequest,
    settleConfirm,
  } from './confirm-dialog.svelte.ts';

  const { i18n } = getAppContext();

  let request = $derived(getConfirmRequest());

  function handleConfirm() {
    settleConfirm(true);
  }

  function handleCancel() {
    settleConfirm(false);
  }

  function handleBackdrop() {
    settleConfirm(false);
  }

  // Escape closes the dialog
  $effect(() => {
    if (!request) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settleConfirm(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if request}
  <div class="dialog-backdrop" onclick={handleBackdrop} role="presentation"></div>

  <div class="dialog" role="alertdialog" aria-modal="true">
    <div class="dialog-header">
      <h3>{request.title}</h3>
    </div>

    <div class="dialog-body">
      <p class="dialog-message">{request.message}</p>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={handleCancel}>
        {request.cancelLabel ?? i18n.t('common.cancel')}
      </button>

      <button
        class="btn"
        class:btn-danger={request.danger}
        class:btn-primary={!request.danger}
        onclick={handleConfirm}
      >
        {request.confirmLabel ?? i18n.t('common.confirm')}
      </button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    z-index: 300;
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 301;
    overflow: hidden;
  }

  .dialog-header {
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--border-color);
  }

  .dialog-header h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
  }

  .dialog-body {
    padding: var(--space-lg);
  }

  .dialog-message {
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    line-height: 1.5;
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

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-danger {
    background: var(--danger);
    color: #fff;
  }

  .btn-danger:hover {
    filter: brightness(1.1);
  }

  .btn-secondary {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--border-color);
  }
</style>