<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';

  import { useTemperatureData } from '../../data/use-temperature.svelte.ts';
  import { buildTargetGcode } from '../../lib/data.ts';
  import type { TemperatureSensor } from '../../types.ts';
  import TargetInput from '../shared/TargetInput.svelte';

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
  const api = mpuApi ?? ctxApi;
  const i18n = useI18n();

  const injected = mpuParams ?? params;
  const printerId = injected?.printerId ?? api.printer.id;

  if (!injected?.printerId) {
    console.warn('[fleet-temps] printerId NOT injected — fallback to active printer.');
  }

  const store = useTemperatureData(api, printerId);

  // Reuse the widget field while keeping requests and errors scoped to this card.
  let busy = $state(false);
  let error = $state('');
  let errorSensor = $state<string | null>(null);

  /** Passive sensors and cards without a known target must never expose commands. */
  function canEdit(sensor: TemperatureSensor): boolean {
    return Boolean(injected?.printerId) && store.connected && store.klippyState === 'ready'
      && (sensor.kind === 'heater' || sensor.kind === 'fan');
  }

  /** Validate against this printer's discovered limits before sending a guarded request. */
  async function saveTarget(sensor: TemperatureSensor, value: number): Promise<void> {
    if (!canEdit(sensor) || busy) return;
    errorSensor = sensor.name;
    const withinLimits = Number.isFinite(value) && value >= 0
      && (value === 0 || sensor.minTemp == null || value >= sensor.minTemp)
      && (sensor.maxTemp == null || value <= sensor.maxTemp);
    const script = withinLimits ? buildTargetGcode(sensor.name, sensor.kind, value) : null;
    if (!script) {
      error = i18n.t('fleet.temps.invalidTarget');
      return;
    }

    busy = true;
    error = '';
    try {
      await api.moonrakerFor(printerId).request('printer.gcode.script', { script });
    } catch (cause) {
      // Guard rejections already appear in the host notification center for this printer.
      if (!(cause as { rejection?: unknown } | null)?.rejection) {
        error = i18n.t('fleet.temps.setFailed');
      }
    } finally {
      busy = false;
    }
  }

  function fmtTemp(v: number | null): string {
    return v == null ? '—' : String(Math.round(v));
  }
</script>

{#if store.klippyState === 'ready'}
    <div class="fleet-temps">
        {#if store.sensors.length === 0}
            <div class="ft-empty">{i18n.t('fleet.temps.noHeaters')}</div>
        {:else}
            {#each store.sensors as s (s.name)}
                <div class="ft-item">
                    <div class="ft-row">
                        <span class="ft-swatch" style:background={s.color}></span>
                        <span class="ft-name" title={s.name}>{s.displayName}</span>
                        <span class="ft-cur">{fmtTemp(s.temperature)}°</span>
                        {#if canEdit(s)}
                            <TargetInput
                                value={s.target}
                                disabled={busy}
                                label={i18n.t('fleet.temps.editTarget', { name: s.displayName })}
                                onCommit={(value) => void saveTarget(s, value)}
                            />
                        {:else}
                            <span class="ft-target">/ {fmtTemp(s.target)}°</span>
                        {/if}
                    </div>
                    {#if error && errorSensor === s.name}
                        <p class="ft-error" role="alert">{error}</p>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
{/if}

<style>
  .fleet-temps {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm);
  }

  .ft-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    min-width: 0;
  }

  .ft-item { min-width: 0; }
  /* Compact inline targets reuse the widget's field and leave room for names in narrow RTL cards. */
  .ft-row :global(.target-field) { max-width: 110px; }
  .ft-error { margin: var(--space-xs) var(--space-sm) 0; color: var(--danger); overflow-wrap: anywhere; }

  .ft-swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ft-name {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ft-cur {
    font-size: var(--font-size-md);
    font-weight: 700;
    font-family: monospace;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    flex-shrink: 0;
    direction: ltr;
  }

  .ft-target {
    font-size: var(--font-size-sm);
    font-family: monospace;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    flex-shrink: 0;
    direction: ltr;
  }
  .ft-empty {
    padding: var(--space-sm);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
  }
</style>
