<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types.ts';
  import { useI18n, useWidget } from '../../../../../plugin-sdk/src/svelte/index';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import { filamentAlertsFor } from '../../data/filament-alerts.svelte.ts';
  import { useFilament, type FilamentSensor, type FilamentState } from '../../data/use-filament.svelte.ts';

  let {
    mpuApi,
    mpuParams,
    params,
  }: {
    mpuApi?: PluginApi;
    mpuParams?: Record<string, string>;
    params?: Record<string, string>;
  } = $props();

  const ctxApi = useWidget();
  // The extension mount fixes its API and printer ID for the lifetime of this element.
  // svelte-ignore state_referenced_locally
  const api = mpuApi ?? ctxApi;
  const i18n = useI18n();
  // svelte-ignore state_referenced_locally
  const printerId = (mpuParams ?? params)?.printerId ?? '';
  const filament = useFilament(api, printerId);
  const klippy = useKlippyState(api, printerId);
  let root = $state<HTMLDivElement | null>(null);
  let alarms = $derived(filamentAlertsFor(printerId));

  // System receives only the summary; sensor names and readings stay with this plugin.
  $effect(() => {
    if (!root) return;
    const count = alarms.length;
    root.dispatchEvent(new CustomEvent('mpu:fleet-health-report', {
      bubbles: true,
      composed: true,
      detail: { severity: count > 0 ? 'crit' : 'none', count },
    }));
  });

  /** Reuses the widget's sensor names without exposing any command controls. */
  function kindLabel(sensor: FilamentSensor): string {
    if (sensor.kind === 'switch') return i18n.t('widgets.filament.kindSwitch');
    if (sensor.kind === 'motion') return i18n.t('widgets.filament.kindMotion');
    return i18n.t('widgets.filament.kindHall');
  }

  /** Distinguishes unknown readings from disabled or empty sensors. */
  function statusOf(sensor: FilamentSensor): { text: string; tone: string } {
    const state: FilamentState | undefined = filament.states[sensor.id];
    if (!state) return { text: i18n.t('fleet.filament.unknown'), tone: 'muted' };
    if (!state.enabled) return { text: i18n.t('widgets.filament.off'), tone: 'muted' };
    if (state.detected) return { text: i18n.t('widgets.filament.detected'), tone: 'ok' };
    return {
      text: i18n.t('widgets.filament.empty'),
      tone: alarms.includes(sensor.id) ? 'critical' : 'empty',
    };
  }
</script>

<div class="fleet-filament" bind:this={root}>
  <h4>{i18n.t('widgets.filament.title')}</h4>
  {#if !printerId || !klippy.ready}
    <p class="placeholder">{i18n.t('fleet.filament.notReady')}</p>
  {:else if filament.sensors.length === 0}
    <p class="placeholder">{i18n.t('widgets.filament.noSensors')}</p>
  {:else}
    <ul>
      {#each filament.sensors as sensor (sensor.id)}
        {@const state = filament.states[sensor.id]}
        {@const status = statusOf(sensor)}
        <li>
          <span class="identity">
            <bdi class="name" title={sensor.id}>{sensor.name}</bdi>
            <span class="kind">{kindLabel(sensor)}</span>
          </span>
          {#if sensor.kind === 'hall' && state?.diameter != null}
            <span class="diameter" dir="ltr">{state.diameter.toFixed(2)} mm</span>
          {/if}
          <span class="status {status.tone}">{status.text}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  :global(mpu-core-widgets-fleet-filament-health) {
    display: block;
    min-width: 0;
  }

  .fleet-filament {
    min-width: 0;
    border-block-start: 1px solid var(--border-color);
    padding-block-start: var(--space-sm);
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

  /* Rows wrap within Fleet Health's narrow popover in both text directions. */
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
    min-width: 0;
  }

  .identity {
    display: flex;
    flex: 1 1 100px;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    color: var(--text-primary);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .kind, .placeholder {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }

  .placeholder {
    margin: 0;
  }

  .diameter {
    color: var(--text-secondary);
    font-family: monospace;
    font-size: var(--font-size-xs);
    unicode-bidi: isolate;
  }

  .status {
    max-width: 100%;
    border-radius: var(--radius-sm);
    padding: 2px var(--space-xs);
    font-size: var(--font-size-xs);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .status.ok { color: var(--success); }
  .status.empty { color: var(--warning); }
  .status.critical { color: var(--danger); }
  .status.muted { color: var(--text-muted); }
</style>
