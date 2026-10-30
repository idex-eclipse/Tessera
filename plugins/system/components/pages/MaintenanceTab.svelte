<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../shared/icons/Icon.svelte';
  import Panel from './Panel.svelte';
  import StoragePanel from './StoragePanel.svelte';
  import UpdatesPanel from './UpdatesPanel.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  let dbBusy = $state('');
  let dbNotice = $state<{ kind: 'ok' | 'fail'; text: string } | null>(null);

  async function dbAction(action: 'compact' | 'backup'): Promise<void> {
    if (dbBusy) return;
    dbBusy = action;
    dbNotice = null;
    try {
      await api.moonraker().request(`server.database.${action}`);
      dbNotice = { kind: 'ok', text: i18n.t('system.database.ok') };
    } catch (e) {
      console.error('[system] database action failed:', action, e);
      dbNotice = { kind: 'fail', text: i18n.t('system.database.fail') };
    } finally {
      dbBusy = '';
    }
  }
</script>

<div class="page">
  <div class="col">
    <Panel title={i18n.t('system.storage.title')}>
      <StoragePanel />
    </Panel>

    <Panel title={i18n.t('system.database.title')} row>
      <button class="btn" disabled={dbBusy !== ''} onclick={() => dbAction('compact')}>
        <Icon name="refresh" size={14} />
        {i18n.t('system.database.compact')}
      </button>
      <button class="btn" disabled={dbBusy !== ''} onclick={() => dbAction('backup')}>
        <Icon name="download" size={14} />
        {i18n.t('system.database.backup')}
      </button>

      {#if dbNotice}
        <span class="db-notice" class:fail={dbNotice.kind === 'fail'}>
          {dbNotice.text}
        </span>
      {/if}
    </Panel>
  </div>

  <div class="col">
    <UpdatesPanel />
  </div>
</div>

<style>
  .page {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: var(--space-md);
    align-items: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-width: 0;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .db-notice {
    font-size: var(--font-size-sm);
    color: var(--success);
  }

  .db-notice.fail {
    color: var(--danger);
  }
</style>
