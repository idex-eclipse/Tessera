<script lang="ts">
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte';
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import KlipperErrorCollapsed from './KlipperErrorCollapsed.svelte';
  import StatusCollapsed from './StatusCollapsed.svelte';

  const api = usePluginApi();
  const klippy = useKlippyState(api);
</script>

{#if klippy.state != 'ready' }
    <KlipperErrorCollapsed />
{:else}
    <StatusCollapsed />
{/if}
