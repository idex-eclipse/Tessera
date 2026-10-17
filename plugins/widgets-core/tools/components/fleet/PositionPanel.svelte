<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';

  import { useToolhead } from '../../use-toolhead.svelte.ts';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

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
    console.warn('[fleet-position] printerId NOT injected — fallback to active printer.');
  }

  const store = useToolhead(api, printerId);
  const klippy = useKlippyState(api, printerId);

  /**
   * v1: буква direct-оси — ui-настройка плагина (tools.directAxis), а
   * namespace api.settings привязан к активному принтеру. Поэтому в fleet
   * показываем конвенциональную 'U'; per-printer буква приедет вместе с
   * settingsFor(printerId).
   */
  const DIRECT_LABEL = 'U';

  let directActive = $derived(store.isDirectActive);

  let rows = $derived.by<Array<{ label: string; idx: number; dec: number }>>(() => {
    const out = [
      { label: 'X', idx: 0, dec: 2 },
      { label: 'Y', idx: 1, dec: 2 },
      { label: 'Z', idx: 2, dec: 3 },
    ];
    if (directActive) out.push({ label: DIRECT_LABEL, idx: 4, dec: 2 });
    return out;
  });

  function homedFor(label: string): boolean {
    return label === DIRECT_LABEL ? store.directHomed : store.homed(label);
  }
</script>

{#if klippy.state === 'ready'}
    <div class="fleet-position">
        <div class="fp-grid">
        {#each rows as r (r.label)}
            {@const homed = homedFor(r.label)}
            <div
            class="fp-cell"
            class:unhomed={!homed}
            title={homed ? undefined : i18n.t('fleet.position.unhomed')}
            >
            <span class="fp-value">
                {r.label} [{(store.th.position[r.idx] ?? 0).toFixed(2)}]
            </span>
            </div>
        {/each}
        </div>
    </div>
{/if}

<style>
  .fleet-position {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm);
  }

  .fp-grid {
    display: flex;
    flex-direction: row;
    gap: var(--space-xs);
  }

  .fp-cell {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    min-width: 0;
    width: 100%;
  }

  .fp-cell.unhomed {
    opacity: 0.55;
    border-style: dashed;
  }

  .fp-value {
    font-size: var(--font-size-md);
    font-weight: 700;
    font-family: monospace;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
</style>