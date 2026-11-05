<script lang="ts" generics="P extends Record<string, unknown>">
  // Test fixture: provides a fake plugin API to a component under test, the way the host's
  // custom-element wrapper does.
  import type { Component } from 'svelte';

  import { providePluginApi } from '../../../../plugin-sdk/src/svelte/use-plugin-api';
  import type { PluginApi } from '../../../../plugin-sdk/src/types';

  let { api, component: Inner, props }: { api: PluginApi; component: Component<P>; props: P } = $props();

  // svelte-ignore state_referenced_locally
  providePluginApi(api);
</script>

<Inner {...props} />
