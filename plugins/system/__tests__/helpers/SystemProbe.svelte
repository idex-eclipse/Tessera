<script lang="ts">
  // Test fixture: creates the System core the way a component does (via the hook).
  import type { PluginApi } from '../../../../plugin-sdk/src/types';
  import { useSystem } from '../../data/use-system.svelte';

  let { api, printerId, expose }: { api: PluginApi; printerId: string; expose: (s: ReturnType<typeof useSystem>) => void } = $props();

  // svelte-ignore state_referenced_locally
  expose(useSystem(api, printerId));
</script>
