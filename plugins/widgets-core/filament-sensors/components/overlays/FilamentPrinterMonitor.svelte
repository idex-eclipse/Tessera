<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import type { PluginApi } from '../../../../../plugin-sdk/src/types.ts';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import { publishFilamentRunout } from '../../../notifications.ts';
  import {
    clearFilamentAlerts,
    EMPTY_FILAMENT_ALERT_STATE,
    evaluateFilamentAlerts,
    setFilamentAlerts,
  } from '../../data/filament-alerts.svelte.ts';
  import { useFilament } from '../../data/use-filament.svelte.ts';

  let { api, printerId }: { api: PluginApi; printerId: string } = $props();

  // The keyed parent remounts this component when its printer identity changes.
  // svelte-ignore state_referenced_locally
  const filament = useFilament(api, printerId);
  // svelte-ignore state_referenced_locally
  const klippy = useKlippyState(api, printerId);
  let printState = $state<string | null>(null);
  let alertState = EMPTY_FILAMENT_ALERT_STATE;

  // The proxy replays print_stats after reconnect; this monitor stays mounted across routes.
  onMount(() => {
    try {
      return api.moonrakerFor(printerId).subscribe(
        { print_stats: ['state'] },
        (delta: unknown) => {
          const state = (delta as { print_stats?: { state?: unknown } } | null)?.print_stats?.state;
          if (typeof state === 'string') printState = state;
        },
        { immediate: true },
      );
    } catch {
      return undefined;
    }
  });

  $effect(() => {
    const result = evaluateFilamentAlerts(alertState, {
      ready: klippy.ready,
      printState,
      sensors: filament.sensors,
      states: filament.states,
    });
    alertState = result.next;
    setFilamentAlerts(printerId, result.next.active);

    for (const sensor of result.triggered) publishFilamentRunout(api, printerId, sensor.name);
  });

  onDestroy(() => clearFilamentAlerts(printerId));
</script>

<!-- The overlay owns subscriptions but has no visible controls. -->
