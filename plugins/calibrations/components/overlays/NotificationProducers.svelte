<script lang="ts">
  import { onMount } from 'svelte';

  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { startNotificationProducers } from '../../notifications';

  const api = usePluginApi();

  // The persistent overlay owns all background subscriptions and releases them with the plugin.
  onMount(() => startNotificationProducers(api));
</script>
