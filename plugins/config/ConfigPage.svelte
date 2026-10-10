<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';
  import FileTable from '../shared/file-table/FileTable.svelte';
  import type { ContextMenuItem } from '../shared/context-menu.svelte';
  import type { FileRef } from '../shared/file-table/file-ops';
  import { fileCap } from '../shared/file-table/file-capabilities';

  const api = usePluginApi();
  const i18n = api.i18n;

  const TABS = ['logs', 'docs', 'config_examples'] as const;
  type Tab = (typeof TABS)[number];
  let tab = $state<Tab>('logs');

    function configMenu(ref: FileRef, isDir: boolean): ContextMenuItem[] {
    if (isDir) {
        return [
        { id: 'zip', label: i18n.t('config.zip'), icon: 'zip' },
        { id: 'rename', label: i18n.t('config.rename'), icon: 'rename' },
        { id: 'delete', label: i18n.t('config.delete'), icon: 'delete', danger: true },
        ];
    }
    return [
        { id: 'edit', label: i18n.t('config.edit'), icon: 'edit' },
        { id: 'zip', label: i18n.t('config.zip'), icon: 'zip' },
        { id: 'download', label: i18n.t('config.download'), icon: 'download' },
        { id: 'rename', label: i18n.t('config.rename'), icon: 'rename' },
        { id: 'copy', label: i18n.t('config.copy'), icon: 'copy' },
        { id: 'delete', label: i18n.t('config.delete'), icon: 'delete', danger: true },
    ];
    }

  function plainMenu(ref: FileRef, isDir: boolean): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (!isDir) {
        const cap = fileCap(api, ref.path.split('/').pop() ?? '', ref.root);
        if (cap.canOpen) {
        items.push({
            id: 'edit',
            label: i18n.t(cap.readonly ? 'config.open' : 'config.edit'),
            icon: cap.readonly ? 'file' : 'edit',
        });
        }
        items.push({ id: 'download', label: i18n.t('config.download'), icon: 'download' });
    }
    items.push({ id: 'rename', label: i18n.t('config.rename'), icon: 'rename' });
    items.push({ id: 'delete', label: i18n.t('config.delete'), icon: 'delete', danger: true });
    return items;
  }
</script>

<div class="config-page">
  <FileTable root="config" scope="page:config" mode="simple" showAdd
    title={i18n.t('config.title')} menuItems={configMenu} />

  {#key tab}
    <FileTable root={tab} scope="page:{tab}" mode="simple"
      title={i18n.t('config.otherTitle')} menuItems={plainMenu}>
      {#snippet headerExtra()}
        <div class="tabs">
          {#each TABS as t (t)}
            <button class="tab" class:active={tab === t} onclick={() => (tab = t)}>{t.toUpperCase()}</button>
          {/each}
        </div>
      {/snippet}
    </FileTable>
  {/key}
</div>

<style>
  .config-page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
    height: 100%;
    min-height: 0;
  }

  @media (max-width: 900px) {
    .config-page { grid-template-columns: 1fr; }
  }

  .tabs {
    display: flex;
    gap: var(--space-md);
    padding: 0 var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .tab {
    padding: var(--space-sm) var(--space-xs);
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
</style>