<script lang="ts">
  import type { Component as SvelteComponent } from 'svelte';

  import { providePluginApi } from '../svelte/index';
  import type { PluginApi } from '../types';

  let {
    Component,
    api,
    params = {},
  }: {
    Component: SvelteComponent<any>;
    api: PluginApi;
    params?: Record<string, string>;
  } = $props();

  providePluginApi(api);
</script>

<Component {params} />