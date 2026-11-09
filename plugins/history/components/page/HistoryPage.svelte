<script lang="ts">
  import { onDestroy, tick } from 'svelte';

  import { ExtensionPoint, usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import type { ExtensionRef } from '../../../../plugin-sdk/src/types';

  import FileTable from '../../../shared/file-table/FileTable.svelte';
  import FileTableHeaderActions from '../../../shared/file-table/FileTableHeaderActions.svelte';
  import { requestSearchFocus } from '../../../shared/file-table/file-table-state.svelte.ts';
  import type { HistoryJobEntry } from '../../../shared/file-table/use-history-files.svelte.ts';
  import Icon from '../../../shared/icons/Icon.svelte';
  import Tabs, { type TabItem } from '../../../shared/tabs/Tabs.svelte';

  import { HISTORY_SCOPE } from '../../hotkeys.ts';
  import { historyUi, selectHistoryTab } from '../../state/page-ui-state.svelte.ts';
  import HistoryJobDialog from './HistoryJobDialog.svelte';
  import StatsPanel from './HistoryStats.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;

  // Re-read on any registry change (plugin enabled/disabled, availability, conflict resolution).
  let extVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extVersion++));
  let hasBottomPanels = $derived.by(() => {
    void extVersion;
    return api.extensions.list('panels-bottom').length > 0;
  });
  let statsOriginal = $derived.by(() => {
    void extVersion;
    return api.extensions.resolve('panel-stats').original;
  });
  let extTabs = $derived.by<ExtensionRef[]>(() => {
    void extVersion;
    return api.extensions.list('tabs');
  });

  let selectedJobId = $state<string | null>(null);
  let activeView = $derived(historyUi.activeTab);
  const tabs = $derived<TabItem[]>([
    { id: 'history', label: i18n.t('history.title') },
    { id: 'stats', label: i18n.t('stats.combinedTitle') },
    // Extension refs are stable, globally unique tab ids used by ExtensionPoint.only.
    ...extTabs.map((tab) => ({ id: tab.ref, label: tab.title })),
  ]);

  /** Selects a known page view and closes a detail card that would otherwise become hidden. */
  function selectView(id: string): void {
    if (!tabs.some((tab) => tab.id === id)) return;
    selectHistoryTab(id);
    if (id !== 'history') selectedJobId = null;
  }

  // Keep hotkey navigation synchronized with currently available extension tabs.
  $effect(() => {
    const order = tabs.map((tab) => tab.id);
    historyUi.tabOrder = order;
    if (!order.includes(historyUi.activeTab)) historyUi.activeTab = 'history';
  });

  // Deep links use the same built-in id or extension ref contract as other extensible pages.
  let appliedSection = '';
  $effect(() => {
    const section = params.section;
    if (!section || section === appliedSection || !tabs.some((tab) => tab.id === section)) return;
    appliedSection = section;
    selectView(section);
  });

  /** Only rows backed by a Moonraker job id can open a stable detail session. */
  function openJob(entry: HistoryJobEntry): void {
    if (entry.jobId) selectedJobId = entry.jobId;
  }

  // Ctrl+F first reveals the table, then focuses its search after Svelte mounts the tab body.
  let lastShowHistorySeq = historyUi.showHistorySeq;
  $effect(() => {
    const seq = historyUi.showHistorySeq;
    if (seq === lastShowHistorySeq) return;
    lastShowHistorySeq = seq;
    if (activeView === 'history') return;
    selectView('history');
    void tick().then(() => requestSearchFocus(api, HISTORY_SCOPE));
  });

  const offPrinter = api.onPrinterChange(() => (selectedJobId = null));
  onDestroy(offPrinter);

  $effect(() => {
    historyUi.jobDialogOpen = selectedJobId !== null;
    return () => {
      historyUi.jobDialogOpen = false;
    };
  });
</script>

<!-- page (replacement): the whole content below, including the bottom panels -->
<ExtensionPoint point="page">
  {#snippet original()}
    <div class="history-page">
      <div class="history-tabs-card">
        <Tabs {tabs} active={activeView} onSelect={selectView} label={i18n.t('history.tabsLabel')}>
          {#snippet trailing()}
            {#if activeView === 'history'}
              <!-- History actions share the tab row so the full-height table needs no second header. -->
              <FileTableHeaderActions
                scope={HISTORY_SCOPE}
                mode="history"
                root="history"
                menuEnabled={false}
              />
            {:else if activeView === 'stats' && statsOriginal}
              <button
                class="reset-button"
                class:active={historyUi.resetDialogOpen}
                title={i18n.t('stats.reset')}
                aria-label={i18n.t('stats.reset')}
                onclick={() => historyUi.resetRequestSeq++}
              >
                <Icon name="delete" />
              </button>
            {/if}
          {/snippet}

          {#if activeView === 'history'}
            <div class="tab-body history-view">
              <ExtensionPoint point="panel-history">
                {#snippet original()}
                  <FileTable
                    root="history"
                    scope={HISTORY_SCOPE}
                    mode="history"
                    showHeader={false}
                    menuEnabled={false}
                    onRowActivate={openJob}
                    embedded
                  />
                  <HistoryJobDialog jobId={selectedJobId} onClose={() => (selectedJobId = null)} />
                {/snippet}
              </ExtensionPoint>
            </div>
          {:else if activeView === 'stats'}
            <div class="tab-body stats-view">
              <ExtensionPoint point="panel-stats">
                {#snippet original()}<StatsPanel />{/snippet}
              </ExtensionPoint>
            </div>
          {:else}
            <div class="tab-body extension-view">
              <ExtensionPoint point="tabs" only={activeView} />
            </div>
          {/if}
        </Tabs>
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
  .history-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    height: 100%;
    min-height: 0;
  }

  .history-tabs-card {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  /* The shared tab panel and either table consume all remaining page height. */
  .history-tabs-card :global(.tabpanel) { display: flex; flex: 1; min-height: 0; }
  .tab-body { display: flex; flex: 1; min-width: 0; min-height: 0; }
  .tab-body :global(.mpu-ext-item) { width: 100%; height: 100%; min-height: 0; }

  .reset-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .reset-button:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .reset-button.active { background: var(--bg-surface-active); color: var(--accent); }

  /* Bottom panels scroll on their own so they can never push the table out of the viewport. */
  .bottom {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    max-height: 40%;
    min-height: 0;
    overflow-y: auto;
  }
</style>
