<script lang="ts">
  import { getAppContext } from '../../app-context.ts';
  import { confirm } from '../confirm/confirm-dialog.svelte.ts';
  import Icon from '../icons/Icon.svelte';

  let { narrow = false }: { narrow?: boolean } = $props();

  const { editor, registry, printerManager, i18n } = getAppContext();

  let printerId = $derived(printerManager.activePrinterId);
  let hasLayout = $derived(printerId ? registry.getDashboardLayout(printerId).length > 0 : false);

  async function reset(): Promise<void> {
    if (!printerId) return;
    const ok = await confirm({
      title: i18n.t('dashboard.resetLayout'),
      message: i18n.t('dashboard.resetLayoutConfirm'),
      danger: true,
    });
    if (!ok) return;
    registry.resetDashboardLayout(printerId);
    editor.changed();
  }

  async function cancel(): Promise<void> {
    if (editor.dirty) {
      const ok = await confirm({
        title: i18n.t('dashboard.cancelEdit'),
        message: i18n.t('dashboard.cancelEditConfirm'),
        danger: true,
      });
      if (!ok) return;
    }
    editor.cancel();
  }
</script>

{#if editor.active && printerId}
  <div class="edit-toolbar" class:narrow>
    {#if !narrow}<span class="hint">{i18n.t('dashboard.editHint')}</span>{/if}

    <div class="history">
      <button
        class="icon-btn"
        disabled={!editor.canUndo}
        onclick={() => editor.undo()}
        aria-label={i18n.t('dashboard.undo')}
        title={i18n.t('dashboard.undo')}
      >
        <Icon name="undo" size={18} flip />
      </button>
      <button
        class="icon-btn"
        disabled={!editor.canRedo}
        onclick={() => editor.redo()}
        aria-label={i18n.t('dashboard.redo')}
        title={i18n.t('dashboard.redo')}
      >
        <Icon name="redo" size={18} flip />
      </button>
    </div>

    <button class="btn btn-secondary" onclick={() => (editor.addDialogOpen = true)}>
      + {i18n.t('dashboard.addWidget')}
    </button>
    {#if hasLayout}
      <button class="btn btn-secondary" onclick={reset}>{i18n.t('dashboard.resetLayout')}</button>
    {/if}
    <button class="btn btn-danger" onclick={cancel}>{i18n.t('dashboard.cancelEdit')}</button>
    <button class="btn btn-primary" onclick={() => editor.end()}>{i18n.t('common.save')}</button>
  </div>
{/if}

<style>
  .edit-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
    flex-shrink: 0;
    margin-bottom: var(--space-md);
  }

  /* Узкий экран: прокручивается вся main, панель остаётся у верхнего края.
     Отрицательный top съедает паддинг main, иначе над панелью виден зазор. */
  .edit-toolbar.narrow {
    position: sticky;
    top: calc(-1 * var(--space-lg));
    /* Выше ✕ чипов (5) и ниже боковых панелей-оверлеев (--z-drawer) */
    z-index: 10;
    gap: var(--space-xs);
    margin-inline: calc(-1 * var(--space-lg));
    /* Сверху запас под язычок, свисающий из шапки по центру экрана */
    padding: 24px var(--space-lg) var(--space-sm);
    background: var(--bg-app);
    border-bottom: 1px solid var(--border-color);
  }

  .hint {
    flex: 1;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .history {
    display: flex;
    gap: var(--space-xs);
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target);
    height: 32px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    cursor: pointer;
  }

  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn {
    min-height: 32px;
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-secondary {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .btn-danger {
    background: var(--danger);
    color: #fff;
  }

  .edit-toolbar.narrow .btn {
    flex: 1 1 auto;
    padding-inline: var(--space-sm);
  }

  .edit-toolbar.narrow .icon-btn {
    width: 36px;
  }
</style>
