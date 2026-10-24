<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import FileTable from '../shared/file-table/FileTable.svelte';

  import { HISTORY_SCOPE } from './hotkeys.ts';
  import StatsPanel from './HistoryStats.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
</script>

<div class="history-page">
  <StatsPanel />

  <FileTable
    root="history"
    scope={HISTORY_SCOPE}
    mode="history"
    title={i18n.t('history.title')}
    menuEnabled={false}
  />
</div>

<style>
  .history-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    height: 100%;
    min-height: 0;
  }
</style>