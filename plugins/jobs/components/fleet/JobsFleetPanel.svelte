<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import { useWidget } from '../../../../plugin-sdk/src/svelte/index';

  import FleetActionButton from '../../../shared/fleet-action-button.svelte';
  import FleetDialog from '../../../shared/fleet-dialog.svelte';
  import JobsBrowser from '../shared/JobsBrowser.svelte';
  import { acquireJobsModal } from '../../state/page-ui-state.svelte.ts';

  /** Fleet parameters are injected by the host Custom Element wrapper. */
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

  // Global Jobs hotkeys stay dormant while the fleet browser owns focus.
  $effect(() => {
    if (!open) return;
    return acquireJobsModal();
  });
</script>

<FleetActionButton label={api.i18n.t('jobs.title')} icon="file" onclick={() => (open = true)} />

<FleetDialog
  {open}
  title={api.i18n.t('jobs.fleetDialogTitle', { name: printerName })}
  closeLabel={api.i18n.t('common.close')}
  onClose={() => (open = false)}
>
  <JobsBrowser scope="fleet:gcodes" {printerId} showHeaderTitle={false} embedded />
</FleetDialog>
