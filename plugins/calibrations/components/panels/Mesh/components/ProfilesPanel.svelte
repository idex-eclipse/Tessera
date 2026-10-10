<script lang="ts">
  import { usePluginApi } from '../../../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../../../shared/icons/Icon.svelte';
  import ConfirmDialog from '../../../../../shared/confirm-dialog.svelte';

  import { gcode, runGcode } from '../../../../commands';
  import type { BedMeshStore } from '../../../../use-bed-mesh.svelte.ts';

  let { store }: { store: BedMeshStore } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;

  let busy = $state(''); // 'load:<name>' | 'delete:<name>'
  let deleteTarget = $state<string | null>(null);

  async function exec(action: string, script: string): Promise<boolean> {
    if (busy) return false;
    busy = action;
    try {
      await runGcode(api.moonraker(), script);
      return true;
    } catch (e) {
      console.error('[bed-mesh] gcode failed:', script, e);
      return false;
    } finally {
      busy = '';
    }
  }

  async function loadProfile(name: string): Promise<void> {
    if (await exec(`load:${name}`, gcode.bedMeshProfileLoad(name))) {
      await store.refresh();
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const name = deleteTarget;
    deleteTarget = null;
    if (await exec(`delete:${name}`, gcode.bedMeshProfileDelete(name))) {
      await store.refresh();
    }
  }
</script>

{#if store.profileNames.length === 0}
  <p class="empty">{i18n.t('bedMesh.profiles.empty')}</p>
{:else}
  <table class="profiles-table">
    <thead>
      <tr>
        <th>{i18n.t('bedMesh.profiles.name')}</th>
        <th class="col-num">{i18n.t('bedMesh.profiles.points')}</th>
        <th>{i18n.t('bedMesh.profiles.algo')}</th>
        <th class="col-actions">{i18n.t('bedMesh.profiles.actions')}</th>
      </tr>
    </thead>

    <tbody>
      {#each store.profileNames as name (name)}
        {@const p = store.mesh.profiles[name]}
        {@const active = name === store.mesh.profileName}
        <tr class:active>
          <td>
            <span class="cell-name">
              <span class="name">{name}</span>
              {#if active}
                <span
                  class="active-dot"
                  title={i18n.t('bedMesh.profiles.active')}
                ></span>
              {/if}
            </span>
          </td>
          <td class="col-num">
            {p ? `${p.points[0]?.length ?? 0}×${p.points.length}` : '—'}
          </td>
          <td class="col-algo">{p?.meshParams.algo ?? '—'}</td>
          <td class="col-actions">
            <button
              class="row-btn"
              disabled={busy !== '' || active || !store.tools.profile}
              onclick={() => loadProfile(name)}
              title={i18n.t('bedMesh.profiles.load')}
            >
              <Icon name="download" size={14} />
            </button>
            <button
              class="row-btn danger"
              disabled={busy !== '' || !store.tools.profile}
              onclick={() => (deleteTarget = name)}
              title={i18n.t('bedMesh.profiles.delete')}
            >
              <Icon name="delete" size={14} />
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<ConfirmDialog
  open={deleteTarget !== null}
  title={i18n.t('bedMesh.profiles.delete')}
  message={i18n.t('bedMesh.profiles.deleteConfirm', { name: deleteTarget ?? '' })}
  confirmLabel={i18n.t('bedMesh.profiles.delete')}
  danger={true}
  onConfirm={confirmDelete}
  onClose={() => (deleteTarget = null)}
/>

<style>
  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-md);
    font-size: var(--font-size-sm);
  }

  .profiles-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .profiles-table th {
    text-align: start;
    color: var(--text-muted);
    font-weight: 500;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }

  .profiles-table td {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .profiles-table tbody tr:last-child td {
    border-bottom: none;
  }

  .profiles-table tr.active td {
    background: var(--bg-surface-active);
  }

  .cell-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    max-width: 100%;
  }

  .name {
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .active-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
    flex-shrink: 0;
  }

  .col-num {
    font-family: monospace;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .col-algo {
    color: var(--text-secondary);
  }

  .col-actions {
    text-align: end;
    white-space: nowrap;
  }

  .row-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .row-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover-no-override);
    color: var(--text-primary);
  }

  .row-btn.danger:hover:not(:disabled) {
    color: var(--danger);
  }

  .row-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>