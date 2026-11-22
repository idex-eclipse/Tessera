<script lang="ts">
  import { useI18n } from '../../../../plugin-sdk/src/svelte/index';
  import { pageHash } from '../../../shared/page-nav';
  import {
    subscribeHeaterDeviationAlerts,
    type HeaterDeviationAlert,
  } from '../../data/heater-alerts.svelte.ts';

  let {
    mpuParams,
    params,
  }: {
    mpuParams?: Record<string, string>;
    params?: Record<string, string>;
  } = $props();

  const i18n = useI18n();
  // The extension mount fixes its printer ID for the lifetime of this element.
  // svelte-ignore state_referenced_locally
  const printerId = (mpuParams ?? params)?.printerId ?? '';

  let root = $state<HTMLDivElement | null>(null);
  let alerts = $state<readonly HeaterDeviationAlert[]>([]);
  $effect(() => subscribeHeaterDeviationAlerts((all) => (alerts = all)));
  let own = $derived(alerts.filter((alert) => alert.printerId === printerId));

  // System receives only the summary; heater names and readings stay with this plugin.
  // A sustained deviation means the PID coefficients no longer fit the heater, hence 'crit'.
  $effect(() => {
    if (!root) return;
    const count = own.length;
    root.dispatchEvent(new CustomEvent('mpu:fleet-health-report', {
      bubbles: true,
      composed: true,
      detail: { severity: count > 0 ? 'crit' : 'none', count },
    }));
  });

  /** Routes to this printer's Heaters tab; the host closes fleet mode on navigation. */
  function openHeater(alert: HeaterDeviationAlert): void {
    if (!printerId) return;
    globalThis.location.hash =
      `${pageHash(printerId, 'calibrations')}?section=heaters&heater=${encodeURIComponent(alert.heaterId)}`;
  }
</script>

<!-- The root stays mounted so the summary report keeps flowing while there is nothing to show. -->
<div class="fleet-heaters" bind:this={root} hidden={own.length === 0}>
  {#if own.length > 0}
    <h4>{i18n.t('calibrations.section.heaters')}</h4>
    <ul>
      {#each own as alert (alert.heaterId)}
        <li>
          <button type="button" class="row" onclick={() => openHeater(alert)}>
            <bdi class="name" title={alert.heaterId}>{alert.displayName}</bdi>
            <span class="deviation" dir="ltr">
              {i18n.t('calibrations.fleet.deviationRow', {
                dev: alert.deviation.toFixed(1),
                target: alert.target.toFixed(0),
              })}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="hint">{i18n.t('calibrations.fleet.pidHint')}</p>
  {/if}
</div>

<style>
  :global(mpu-calibrations-fleet-heaters-health) {
    display: block;
    min-width: 0;
  }

  .fleet-heaters {
    min-width: 0;
    border-block-start: 1px solid var(--border-color);
    padding-block-start: var(--space-sm);
  }

  .fleet-heaters[hidden] {
    display: none;
  }

  h4 {
    margin: 0 0 var(--space-xs);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    min-width: 0;
  }

  /* Full-width buttons wrap within Fleet Health's narrow popover in both text directions. */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
    width: 100%;
    min-width: 0;
    min-height: var(--touch-target, 36px);
    border: none;
    border-radius: var(--radius-sm);
    padding: 2px var(--space-xs);
    background: transparent;
    text-align: start;
    cursor: pointer;
  }

  .row:hover {
    background: var(--bg-surface-hover);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .name {
    flex: 1 1 100px;
    min-width: 0;
    color: var(--text-primary);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .deviation {
    color: var(--danger);
    font-family: monospace;
    font-size: var(--font-size-xs);
    font-weight: 600;
    unicode-bidi: isolate;
  }

  .hint {
    margin: var(--space-xs) 0 0;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }
</style>
