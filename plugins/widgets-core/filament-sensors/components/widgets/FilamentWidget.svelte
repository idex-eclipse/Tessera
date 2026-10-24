<script lang="ts">
  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../shared/icons/Icon.svelte';

  import KlippyNotReady from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { useFilament, type FilamentSensor } from '../../use-filament.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useFilament(api);
  const klippy = useKlippyState(api);

  function kindLabel(s: FilamentSensor): string {
    if (s.kind === 'switch') return i18n.t('widgets.filament.kindSwitch');
    if (s.kind === 'motion') return i18n.t('widgets.filament.kindMotion');
    return i18n.t('widgets.filament.kindHall');
  }

  function statusOf(s: FilamentSensor): { text: string; cls: 'ok' | 'bad' | 'off' } {
    const st = store.states[s.id];
    if (!st?.enabled) return { text: i18n.t('widgets.filament.off'), cls: 'off' };
    return st.detected
      ? { text: i18n.t('widgets.filament.detected'), cls: 'ok' }
      : { text: i18n.t('widgets.filament.empty'), cls: 'bad' };
  }
</script>

{#if !klippy.ready}
  <KlippyNotReady />
{:else if store.sensors.length === 0}
  <p class="empty">{i18n.t('widgets.filament.noSensors')}</p>
{:else}
  <div class="fil">
    {#each store.sensors as s (s.id)}
      {@const st = store.states[s.id]}
      {@const status = statusOf(s)}

      <div class="fil-row">
        <div class="fil-info">
          <bdi class="fil-name" title={s.id}>{s.name}</bdi>
          <span class="fil-kind">{kindLabel(s)}</span>
        </div>

        {#if s.kind === 'hall'}
          <span class="fil-value" dir="ltr" title="{i18n.t('widgets.filament.diameter')}{st?.raw != null ? ` · raw ${st.raw}` : ''}">
            {(st?.diameter ?? 0).toFixed(2)} mm
          </span>
        {/if}

        <span class="fil-status {status.cls}">{status.text}</span>

        <label class="fil-check" title={i18n.t('widgets.filament.enable')}>
          <input
            type="checkbox"
            checked={st?.enabled ?? false}
            onchange={(e) => store.setEnabled(s, e.currentTarget.checked)}
          />
        </label>
      </div>

      {#if s.kind === 'hall'}
        <div class="fil-sub">
          <label class="fil-check flow">
            <input
              type="checkbox"
              checked={st?.flowComp ?? false}
              onchange={(e) => store.setFlowComp(e.currentTarget.checked)}
            />
            {i18n.t('widgets.filament.flowComp')}
          </label>

          <button
            class="fil-reset"
            title={i18n.t('widgets.filament.reset')}
            onclick={() => store.resetWidth()}
          >
            <Icon name="rollback" size={13} />
          </button>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  :global(mpu-widgets-filament) {
    display: block;
    height: 100%;
  }

  .fil {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    height: 100%;
    overflow-y: auto;
    min-height: 0;
    padding: var(--space-xs);
  }

  .empty {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
  }

  .fil-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .fil-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .fil-name {
    display: block;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fil-kind {
    font-size: 11px;
    color: var(--text-muted);
  }

  .fil-value {
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .fil-status {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .fil-status.ok {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, transparent);
  }

  .fil-status.bad {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .fil-status.off {
    color: var(--text-muted);
    background: var(--bg-surface-hover);
  }

  .fil-check input {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .fil-sub {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding-block: 0;
    padding-inline: var(--space-md) 0;
  }

  .fil-check.flow {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .fil-reset {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .fil-reset:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
</style>