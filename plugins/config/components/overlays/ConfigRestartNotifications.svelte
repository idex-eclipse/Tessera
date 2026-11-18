<script lang="ts">
  import { onMount } from 'svelte';
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { configRestartMonitor } from '../../../shared/file-table/config-restart-monitor';
  import { notifyConfigRestartFailure } from '../../notifications';

  const api = usePluginApi();

  /** A persistent overlay observes restored checks even when Config is not the current page. */
  onMount(() => {
    const subscriptions = new Map<string, () => void>();

    function attach(printers: Array<{ id: string }>): void {
      const active = new Set(printers.map((printer) => printer.id));
      for (const [id, unsubscribe] of subscriptions) {
        if (active.has(id)) continue;
        unsubscribe();
        subscriptions.delete(id);
      }
      for (const printer of printers) {
        if (subscriptions.has(printer.id)) continue;
        const monitor = configRestartMonitor(printer.id, api.moonrakerFor(printer.id));
        subscriptions.set(printer.id, monitor.subscribe((attempt) => notifyConfigRestartFailure(api, printer.id, attempt)));
      }
    }

    attach(api.printers);
    const offPrinters = api.onPrintersChange(attach);
    return () => {
      offPrinters();
      for (const unsubscribe of subscriptions.values()) unsubscribe();
    };
  });
</script>

<!-- The overlay provides lifecycle only; the host notification center owns visible chrome. -->
