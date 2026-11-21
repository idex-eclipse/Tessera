<script lang="ts">
  import { ExtensionPoint } from '../../../../../../plugin-sdk/src/svelte/index';
  import JobQueueContent from '../../shared/JobQueueContent.svelte';
</script>

<!-- Extensions still replace the complete widget body; the original now shares its view with fleet. -->
<div class="job-queue-widget">
  <ExtensionPoint point="widget-job-queue">
    {#snippet original()}
      <JobQueueContent />
    {/snippet}
  </ExtensionPoint>
</div>

<style>
  :global(mpu-widgets-job-queue) {
    display: block;
    height: 100%;
  }
  .job-queue-widget { height: 100%; }
</style>
