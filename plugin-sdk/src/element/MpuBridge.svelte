<script lang="ts">
  import type { Component as SvelteComponent } from 'svelte';

  import { providePluginApi } from '../svelte/index';
  import type { MpuParams, PluginApi } from '../types';

  let {
    Component,
    api,
    params = {},
  }: {
    Component: SvelteComponent<{ params?: MpuParams }>;
    api: PluginApi;
    params?: MpuParams;
  } = $props();

  providePluginApi(api);
</script>

<Component {params} />