<script lang="ts">
  import type { NotificationActionInput } from '../../../../plugin-sdk/src/types';

  import PluginSurface from '../PluginSurface.svelte';

  let {
    pluginId,
    actions = [],
  }: {
    pluginId: string;
    actions?: NotificationActionInput[];
  } = $props();

  /** Missing action elements are stale plugin data and must not replace the notification with an error. */
  function isRegistered(tag: string): boolean {
    return typeof customElements !== 'undefined' && customElements.get(tag) !== undefined;
  }
</script>

{#if actions.some((action) => isRegistered(action.element))}
  <div class="notification-actions">
    {#each actions as action, index (`${action.element}:${index}`)}
      {#if isRegistered(action.element)}
        <span class="notification-action">
          <PluginSurface
            {pluginId}
            tag={action.element}
            params={action.params ?? {}}
            fill={false}
          />
        </span>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .notification-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-inline-start: 2px;
    vertical-align: middle;
  }

  .notification-action,
  .notification-action :global(.host) {
    display: inline-flex;
    align-items: center;
  }
</style>
