<script lang="ts" generics="P extends Record<string, unknown>">
  import type { Component } from 'svelte';

  import { providePluginApi } from '../../../../../plugin-sdk/src/svelte/use-plugin-api';
  import type { PluginApi } from '../../../../../plugin-sdk/src/types';

  let { api, component: Inner, props }: { api: PluginApi; component: Component<P>; props: P } = $props();

  // The wrapper mirrors the host bridge for client-compiled component tests.
  // svelte-ignore state_referenced_locally
  providePluginApi(api);
</script>

<Inner {...props} />
