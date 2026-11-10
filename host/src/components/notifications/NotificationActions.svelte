<script lang="ts">
  import type { NotificationActionInput } from '../../../../plugin-sdk/src/types';

  import { getAppContext } from '../../app-context';
  import type {
    HostSettingsNotificationAction,
    NotificationAction,
  } from '../../core/notification-center.svelte.ts';
  import PluginSurface from '../PluginSurface.svelte';

  let {
    pluginId,
    actions = [],
  }: {
    pluginId: string;
    actions?: NotificationAction[];
  } = $props();

  const ctx = getAppContext();

  /** Missing action elements are stale plugin data and must not replace the notification with an error. */
  function isRegistered(tag: string): boolean {
    return typeof customElements !== 'undefined' && customElements.get(tag) !== undefined;
  }

  /** The discriminant prevents host routes from being treated as Custom Element descriptors. */
  function isHostSettingsAction(action: NotificationAction): action is HostSettingsNotificationAction {
    return 'kind' in action && action.kind === 'host-settings';
  }

  /** Plugin actions intentionally have no discriminant to preserve the public API shape. */
  function isPluginAction(action: NotificationAction): action is NotificationActionInput {
    return 'element' in action;
  }

  function isAvailable(action: NotificationAction): boolean {
    return isHostSettingsAction(action) || (isPluginAction(action) && isRegistered(action.element));
  }
</script>

{#if actions.some(isAvailable)}
  <div class="notification-actions">
    {#each actions as action, index (index)}
      {#if isHostSettingsAction(action)}
        <button
          class="host-action"
          onclick={() => ctx.router.navigateToSettings(action.section)}
        >
          {ctx.i18n.t(`notifications.update.open.${action.section}`)}
        </button>
      {:else if isPluginAction(action) && isRegistered(action.element)}
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

  .host-action {
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

  .host-action:hover {
    background: var(--bg-surface-active);
  }

  /* Compact actions remain comfortable without forcing a wider notification on touch screens. */
  @media (pointer: coarse) {
    .host-action { min-height: 32px; }
  }
</style>
