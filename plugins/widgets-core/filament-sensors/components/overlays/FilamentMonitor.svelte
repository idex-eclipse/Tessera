<script lang="ts">
  import { onMount } from 'svelte';

  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import FilamentPrinterMonitor from './FilamentPrinterMonitor.svelte';

  const api = usePluginApi();
  let printerIds = $state(api.printers.map((printer) => printer.id));

  // An always-mounted overlay watches all configured printers, even with Fleet closed.
  onMount(() => api.onPrintersChange((printers) => {
    printerIds = printers.map((printer) => printer.id);
  }));
</script>

{#each printerIds as printerId (printerId)}
  <FilamentPrinterMonitor {api} {printerId} />
{/each}
