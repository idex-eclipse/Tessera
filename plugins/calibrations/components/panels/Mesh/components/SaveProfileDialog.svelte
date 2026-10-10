<script lang="ts">
  import { usePluginApi } from '../../../../../../plugin-sdk/src/svelte/index';

  let {
    open,
    existing = [],
    defaultName = '',
    busy = false,
    onSave,
    onClose,
  }: {
    open: boolean;
    existing?: string[];
    defaultName?: string;
    busy?: boolean;
    onSave: (name: string) => void;
    onClose: () => void;
  } = $props();

  const i18n = usePluginApi().i18n;

  let name = $state('');
  let error = $state('');

  $effect(() => {
    if (open) {
      name = defaultName;
      error = '';
    }
  });

  let exists = $derived(existing.includes(name.trim()));

  function submit(): void {
    const trimmed = name.trim();
    if (!trimmed) {
      error = i18n.t('bedMesh.save.required');
      return;
    }
    onSave(trimmed);
  }
</script>

{#if open}
  <div class="dialog-backdrop" onclick={onClose} role="presentation"></div>

  <div class="dialog" role="alertdialog" aria-modal="true">
    <div class="dialog-header">
      <h3>{i18n.t('bedMesh.save.title')}</h3>
    </div>

    <div class="dialog-body">
      <label class="field">
        <span class="field-label">{i18n.t('bedMesh.save.name')}</span>
        <input
          class="field-input"
          type="text"
          bind:value={name}
          disabled={busy}
          onkeydown={(e) => e.key === 'Enter' && submit()}
        />
      </label>

      {#if error}
        <p class="error">{error}</p>
      {/if}
      {#if exists}
        <p class="warn">{i18n.t('bedMesh.save.exists')}</p>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={onClose} disabled={busy}>
        {i18n.t('bedMesh.save.cancel')}
      </button>
      <button class="btn" onclick={submit} disabled={busy}>
        {i18n.t('bedMesh.save.save')}
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
    max-width: 420px;
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
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-lg);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .field-input {
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-md);
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .field-input:focus {
    border-color: var(--accent);
  }

  .error {
    color: var(--danger);
    font-size: var(--font-size-sm);
  }

  .warn {
    color: var(--warning);
    font-size: var(--font-size-sm);
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
    background: var(--accent);
    color: #fff;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
</style>