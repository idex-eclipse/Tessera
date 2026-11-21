<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types.ts';
  import { useWidget } from '../../../../../plugin-sdk/src/svelte/index';

  import FleetActionButton from '../../../../shared/fleet-action-button.svelte';
  import FleetDialog from '../../../../shared/fleet-dialog.svelte';
  import JobQueueContent from '../shared/JobQueueContent.svelte';

  /** Fleet parameters bind queue state and commands to the card's printer. */
  let {
    mpuApi,
    mpuParams,
    params,
  }: {
    mpuApi?: PluginApi;
    mpuParams?: Record<string, string>;
    params?: Record<string, string>;
  } = $props();

  const contextApi = useWidget();
  const api = mpuApi ?? contextApi;
  const printerId = (mpuParams ?? params)?.printerId ?? api.printer.id;
  const printerName = $derived(api.printers.find((printer) => printer.id === printerId)?.name ?? printerId);
  let open = $state(false);
</script>

<FleetActionButton label={api.i18n.t('widgets.jobQueue.title')} icon="rows" onclick={() => (open = true)} />

<FleetDialog
  {open}
  size="medium"
  title={api.i18n.t('widgets.jobQueue.fleetDialogTitle', { name: printerName })}
  closeLabel={api.i18n.t('common.close')}
  onClose={() => (open = false)}
>
  <div class="queue-dialog-body">
    <JobQueueContent {printerId} {api} />
  </div>
</FleetDialog>

<style>
  .queue-dialog-body {
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: var(--space-sm);
    overflow: hidden;
  }
</style>
