<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types';
  import { useTemperatureData } from '../data/use-temperature.svelte';

  let { api, printerId }: { api: PluginApi; printerId: string } = $props();

  // A mounted consumer exercises the keeper and the real Svelte update path.
  // These test props are intentionally fixed for the mounted probe's lifetime.
  // svelte-ignore state_referenced_locally
  const temperature = useTemperatureData(api, printerId);
</script>

<span data-testid="temperature-recovery">{temperature.sensors[0]?.temperature ?? 'missing'}</span>
