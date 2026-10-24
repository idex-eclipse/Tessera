<script lang="ts">
  import type { MpuParams, PluginApi } from '../../../plugin-sdk/src/types';

  /** Custom Element поверхности: хост инжектит api и params свойствами. */
  type MpuElement = HTMLElement & { api: PluginApi; params: MpuParams };

  let {
    tag,
    api,
    params = {},
    fill = true,
  }: {
    tag: string;
    api: PluginApi;
    params?: MpuParams;
    fill?: boolean;
  } = $props();

  let hostEl: HTMLDivElement | null = null;
  let current: MpuElement | null = null;

  function syncDataset(el: HTMLElement, p: MpuParams): void {
    for (const [key, value] of Object.entries(p)) {
      el.dataset[key] = String(value);
    }
  }

  function cleanup(): void {
    current?.remove();
    current = null;
  }

  function mountEl(): void {
    cleanup();
    if (!hostEl) return;

    if (!tag || !customElements.get(tag)) {
      hostEl.innerHTML = `<div class="plugin-error">Element not registered: ${tag || '(empty)'}</div>`;
      return;
    }

    current = document.createElement(tag) as MpuElement;
    current.api = api;
    current.params = params;
    syncDataset(current, params);
    hostEl.appendChild(current);
  }

  $effect(() => {
    void tag;
    void api;
    mountEl();
    return cleanup;
  });

  $effect(() => {
    if (!current) return;
    current.params = params;
    syncDataset(current, params);
  });
</script>

<div class="host" class:fill bind:this={hostEl}></div>

<style>
  .host { min-height: 0; }
  .host.fill { height: 100%; }
  .host :global(.plugin-error) {
    padding: var(--space-md);
    color: var(--danger);
    font-size: var(--font-size-sm);
  }
</style>