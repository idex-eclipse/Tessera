<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import FileTable from '../../../shared/file-table/FileTable.svelte';
  import type { ContextMenuItem } from '../../../shared/context-menu.svelte';
  import type { FileRef } from '../../../shared/file-table/file-ops';
  import { fileCap } from '../../../shared/file-table/file-capabilities';
  import { CONFIG_TABS, pageUi, setActivePane, setTab, type ConfigTab } from '../../state/page-ui-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;

  // Вкладка правой таблицы и «активная панель» живут в module-state: ими управляют hotkeys.
  let tab = $derived(pageUi.tab);

  // Re-read on any registry change (plugin enabled/disabled, availability, conflict resolution).
  let extVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extVersion++));
  let hasBottomPanels = $derived.by(() => {
    void extVersion;
    return api.extensions.list('panels-bottom').length > 0;
  });

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

<!-- page (replacement): the whole content below, including the bottom panels -->
<ExtensionPoint point="page">
  {#snippet original()}
    <div class="config-root">
      <div class="config-page">
        <!-- table-config / table-other (replacement): a replaced table takes over its grid cell -->
        <ExtensionPoint point="table-config">
          {#snippet original()}
            <!-- активная панель нужна hotkey Ctrl+F: он фокусирует поиск той таблицы, где работает пользователь -->
            <div class="pane" onpointerdown={() => setActivePane('left')} onfocusin={() => setActivePane('left')}>
              <FileTable root="config" scope="page:config" mode="simple" showAdd
                title={i18n.t('config.title')} menuItems={configMenu} />
            </div>
          {/snippet}
        </ExtensionPoint>

        <ExtensionPoint point="table-other">
          {#snippet original()}
            <div class="pane" onpointerdown={() => setActivePane('right')} onfocusin={() => setActivePane('right')}>
              {#key tab}
                <FileTable root={tab} scope="page:{tab}" mode="simple"
                  title={i18n.t('config.otherTitle')} menuItems={plainMenu}>
                  {#snippet headerExtra()}
                    <div class="tabs" role="tablist">
                      {#each CONFIG_TABS as t (t)}
                        <button
                          class="tab"
                          class:active={tab === t}
                          role="tab"
                          aria-selected={tab === t}
                          onclick={() => setTab(t as ConfigTab)}
                        >{i18n.t(`config.tab.${t}`)}</button>
                      {/each}
                    </div>
                  {/snippet}
                </FileTable>
              {/key}
            </div>
          {/snippet}
        </ExtensionPoint>
      </div>

      <!-- panels-bottom (append): the area exists only while some extension contributes, so an
           unextended page keeps its full height (an empty container would still add a flex gap) -->
      {#if hasBottomPanels}
        <div class="bottom">
          <ExtensionPoint point="panels-bottom" />
        </div>
      {/if}
    </div>
  {/snippet}
</ExtensionPoint>

<style>
  .pane { min-width: 0; min-height: 0; height: 100%; }

  /* The page is a column: the tables take the free height, the bottom panels get their own band. */
  .config-root {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    height: 100%;
    min-height: 0;
  }

  .config-page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
    flex: 1 1 0;
    min-height: 0;
  }

  /* A table replaced by an extension sits in the host's wrapper, which must stay a normal grid cell. */
  .config-page > :global(.mpu-ext-item) { min-height: 0; height: 100%; }

  /* Bottom panels scroll on their own so they can never push the tables out of the viewport. */
  .bottom {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    max-height: 40%;
    min-height: 0;
    overflow-y: auto;
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
    text-transform: uppercase;
    cursor: pointer;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
</style>