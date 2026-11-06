<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import FileTable from '../../../shared/file-table/FileTable.svelte';

  import { HISTORY_SCOPE } from '../../hotkeys.ts';
  import StatsPanel from './HistoryStats.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  // Re-read on any registry change (plugin enabled/disabled, availability, conflict resolution).
  let extVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extVersion++));
  let hasBottomPanels = $derived.by(() => {
    void extVersion;
    return api.extensions.list('panels-bottom').length > 0;
  });
</script>

<!-- page (replacement): the whole content below, including the bottom panels -->
<ExtensionPoint point="page">
  {#snippet original()}
    <div class="history-page">
      <!-- The slots are our own layout cells: they keep the sizing rules when a panel is replaced,
           whatever element the extension brings. -->
      <div class="slot-stats">
        <ExtensionPoint point="panel-stats">
          {#snippet original()}<StatsPanel />{/snippet}
        </ExtensionPoint>
      </div>

      <div class="slot-table">
        <ExtensionPoint point="panel-history">
          {#snippet original()}
            <FileTable
              root="history"
              scope={HISTORY_SCOPE}
              mode="history"
              title={i18n.t('history.title')}
              menuEnabled={false}
            />
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
  .history-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    height: 100%;
    min-height: 0;
  }

  .slot-stats { flex: none; min-width: 0; }

  /* The table takes the free height and scrolls inside; min-height 0 lets it shrink on small screens. */
  .slot-table {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

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
