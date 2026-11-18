<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types';
  import { providePluginApi } from '../../../../plugin-sdk/src/svelte/use-plugin-api';
  import ConfigEditorBanner from '../../components/banners/ConfigEditorBanner.svelte';
  import ConfigEditorOverlay from '../../components/overlays/ConfigEditorOverlay.svelte';

  let { api, surface }: { api: PluginApi; surface: 'banner' | 'overlay' } = $props();
  // Give the selected Config surface the same plugin context it receives from the host.
  // svelte-ignore state_referenced_locally
  providePluginApi(api);
</script>

{#if surface === 'banner'}
  <ConfigEditorBanner />
{:else}
  <ConfigEditorOverlay />
{/if}
