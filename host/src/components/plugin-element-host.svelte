<script lang="ts">
  import type { PluginApi } from '../../../plugin-sdk/src/types';

  let {
    tag,
    api,
    params = {},
    fill = true,
  }: {
    tag: string;
    api: PluginApi;
    params?: Record<string, string>;
    fill?: boolean;
  } = $props();

  let hostEl: HTMLDivElement | null = null;
  let current: HTMLElement | null = null;

  function syncDataset(el: HTMLElement, p: Record<string, string>): void {
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

    current = document.createElement(tag);
    (current as any).api = api;
    (current as any).params = params;
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
    (current as any).params = params;
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