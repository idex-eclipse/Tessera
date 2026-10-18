<script lang="ts">
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte';
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import KlipperError from './KlipperError.svelte';
  import Status from './Status.svelte';

  const api = usePluginApi();
  const klippy = useKlippyState(api);
</script>

{#if klippy.state != 'ready' }
    <KlipperError />
{:else}
    <Status />
{/if}