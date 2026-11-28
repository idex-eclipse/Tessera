<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types';
  import { useLeds, type LedsStore } from '../data/use-leds.svelte';

  let { api, onStore }: { api: PluginApi; onStore: (store: LedsStore) => void } = $props();

  // Mount the real hook so its per-printer state and Moonraker subscription are exercised.
  // svelte-ignore state_referenced_locally
  const store = useLeds(api, api.printer.id);
  // The fixture supplies this callback once when the test component mounts.
  // svelte-ignore state_referenced_locally
  onStore(store);
</script>
