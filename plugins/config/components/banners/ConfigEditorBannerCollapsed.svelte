<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { editorSession } from '../../state/editor-session.svelte';

  const api = usePluginApi();
  let session = $derived(editorSession(api.printer.id));
  let dirtyCount = $derived(session.tabs.filter((tab) => tab.content !== tab.saved).length);
</script>

{#if session.tabs.length && !session.expanded}
  <!-- The host owns this row's click and keyboard action; its child is display-only. -->
  <span class="summary">{api.i18n.t('config.editorBannerSummary', { count: session.tabs.length, dirty: dirtyCount })}</span>
{/if}

<style>
  .summary { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
