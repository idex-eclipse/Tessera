<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import { useWidget } from '../../../../plugin-sdk/src/svelte/index';

  import FleetActionButton from '../../../shared/fleet-action-button.svelte';
  import FleetDialog from '../../../shared/fleet-dialog.svelte';
  import HistoryStats from '../page/HistoryStats.svelte';

  /** The host injects the card printer so opening another card never uses the active tab. */
  let {
    mpuApi,
    mpuParams,
    params,
  }: {
    mpuApi?: PluginApi;
    mpuParams?: Record<string, string>;
    params?: Record<string, string>;
  } = $props();

  const api = mpuApi ?? useWidget();
  const printerId = (mpuParams ?? params)?.printerId ?? api.printer.id;
  const printerName = $derived(api.printers.find((printer) => printer.id === printerId)?.name ?? printerId);
  let open = $state(false);
</script>

<!-- The shared button and dialog preserve touch targets, focus handling, and narrow-screen sizing. -->
<FleetActionButton label={api.i18n.t('stats.combinedTitle')} icon="activity" onclick={() => (open = true)} />

<FleetDialog
  {open}
  title={api.i18n.t('history.fleetDialogTitle', { name: printerName })}
  closeLabel={api.i18n.t('common.close')}
  onClose={() => (open = false)}
>
  <HistoryStats {printerId} />
</FleetDialog>
