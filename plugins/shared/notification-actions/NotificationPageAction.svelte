<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import { pageHash } from '../page-nav';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();

  /** Builds the deep link from copied strings so history never follows the currently active printer. */
  function openPage(): void {
    const { printerId, pageId, section, heater } = params;
    if (!printerId || !pageId) return;
    const query = new URLSearchParams();
    if (section) query.set('section', section);
    if (heater) query.set('heater', heater);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    globalThis.location.hash = `${pageHash(printerId, pageId)}${suffix}`;
  }

  let label = $derived(params.labelKey ? api.i18n.t(params.labelKey) : '');
</script>

{#if label && params.printerId && params.pageId}
  <button class="notification-page-action" onclick={openPage}>{label}</button>
{/if}

<style>
  .notification-page-action {
    min-height: 22px;
    max-inline-size: 150px;
    padding: 1px var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .notification-page-action:hover {
    background: var(--bg-surface-active);
  }

  /* The compact action stays usable on touch without widening mouse layouts. */
  @media (pointer: coarse) {
    .notification-page-action { min-height: 32px; }
  }
</style>
