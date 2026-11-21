<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { JOBS_PAGE_SCOPE } from '../../hotkeys.ts';
  import JobsBrowser from '../shared/JobsBrowser.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();

  // Registry changes can add or remove the optional bottom region without remounting the page.
  let extVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extVersion++));
  let hasBottomPanels = $derived.by(() => {
    void extVersion;
    return api.extensions.list('panels-bottom').length > 0;
  });
</script>

<div class="jobs-page">
  <ExtensionPoint point="page">
    {#snippet original()}
      <div class="jobs-content">
        <div class="slot-table">
          <ExtensionPoint point="panel-table">
            {#snippet original()}
              <JobsBrowser scope={JOBS_PAGE_SCOPE} inspectPath={params.inspect} />
            {/snippet}
          </ExtensionPoint>
        </div>

        {#if hasBottomPanels}
          <div class="bottom">
            <ExtensionPoint point="panels-bottom" />
          </div>
        {/if}
      </div>
    {/snippet}
  </ExtensionPoint>
</div>

<style>
  .jobs-page,
  .jobs-content {
    height: 100%;
    min-height: 0;
  }
  .jobs-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  /* The table owns scrolling, so narrow viewports never expand the page horizontally. */
  .slot-table {
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }
  .bottom {
    flex: none;
    max-height: 40%;
    min-height: 0;
    overflow-y: auto;
  }
</style>
