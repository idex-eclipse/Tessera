<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';

  import { useTemperatureData } from '../../use-temperature.svelte.ts';

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
                <div class="ft-row">
                    <span class="ft-swatch" style:background={s.color}></span>
                    <span class="ft-name" title={s.name}>{s.displayName}</span>
                    <span class="ft-cur">{fmtTemp(s.temperature)}°</span>
                    <span class="ft-target">/ {fmtTemp(s.target)}°</span>
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

  .ft-klippy {
    padding: var(--space-sm);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-align: center;
  }

  .ft-empty {
    padding: var(--space-sm);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
  }
</style>