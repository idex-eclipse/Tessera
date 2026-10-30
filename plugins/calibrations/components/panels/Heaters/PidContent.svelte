<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);

  // Инициализация выбора нагревателя из списка (если текущий не в списке)
  $effect(() => {
    const h = store.state.heaters;
    if (h.length > 0 && !h.includes(store.heatersState.heater)) {
      store.heatersState.heater = h[0]!;
    }
  });

  // Установка target при смене heater
  $effect(() => {
    const heater = store.heatersState.heater;
    if (!heater) return;
    const max = store.state.heaterMaxTemps[heater] ?? 300;
    const isBed = heater.toLowerCase() === 'heater_bed';
    store.heatersState.target = isBed ? Math.min(60, max) : Math.min(200, max);
  });

  let busy = $state('');
  let saveOpen = $state(false);

  let maxTemp = $derived(store.state.heaterMaxTemps[store.heatersState.heater] ?? 300);
  let targetValid = $derived(store.heatersState.target > 0 && store.heatersState.target <= maxTemp);
  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );
  let currentTemp = $derived(store.state.heaterTemps[store.heatersState.heater]?.actual ?? 0);
  let currentTarget = $derived(store.state.heaterTemps[store.heatersState.heater]?.target ?? 0);

  async function runPid(): Promise<void> {
    if (!store.heatersState.heater || !targetValid || store.heatersState.tuning) return;
    store.heatersState.result = null;
    store.heatersState.tuning = true;
    busy = 'pid';
    try {
      await runGcode(api.moonraker(), gcode.pidCalibrate(store.heatersState.heater, store.heatersState.target));
    } catch (e) {
      store.heatersState.tuning = false;
      console.error('[calibrations] pid failed:', e);
    } finally {
      busy = '';
    }
  }

  function confirmSave(): void {
    saveOpen = false;
    busy = 'save';
    runGcode(api.moonraker(), gcode.saveConfig())
      .then(() => { store.heatersState.result = null; })
      .catch((e) => console.error('[calibrations] save failed:', e))
      .finally(() => { busy = ''; });
  }
</script>

<div class="pid">
  <div class="grid">
    <div class="controls">
      <label class="field">
        <span class="label">{i18n.t('calibrations.heaters.heater')}</span>
        <select class="select" bind:value={store.heatersState.heater} disabled={store.heatersState.tuning}>
          {#each store.state.heaters as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      </label>

      <label class="field">
        <span class="label">{i18n.t('calibrations.heaters.target')} <span class="hint">/ max {maxTemp}</span></span>
        <input class="input" type="number" min="1" max={maxTemp} step="1" bind:value={store.heatersState.target} disabled={store.heatersState.tuning} />
        {#if !targetValid}
          <span class="invalid">{i18n.t('calibrations.heaters.invalidTarget', { max: String(maxTemp) })}</span>
        {/if}
      </label>

      <button class="btn" onclick={runPid} disabled={!targetValid || store.heatersState.tuning || busy !== '' || isPrinting}>
        {#if store.heatersState.tuning}
          <Icon name="loader" size={14} /> {i18n.t('calibrations.heaters.tuning')}
        {:else}
          <Icon name="play" size={14} /> {i18n.t('calibrations.heaters.run')}
        {/if}
      </button>

      {#if store.heatersState.tuning}
        <div class="live" role="status" aria-live="polite">
          <div class="live-row"><span>{i18n.t('calibrations.heaters.actual')}</span><span class="mono">{currentTemp.toFixed(1)} °C</span></div>
          <div class="live-row"><span>{i18n.t('calibrations.heaters.target')}</span><span class="mono">{currentTarget.toFixed(0)} °C</span></div>
        </div>
      {/if}
    </div>

    <div class="results">
      {#if store.heatersState.result}
        <h4 class="results-title">{i18n.t('calibrations.heaters.results')}</h4>
        <div class="cards">
          <div class="card"><span class="card-k">{i18n.t('calibrations.heaters.kp')}</span><span class="card-v mono">{store.heatersState.result.kp.toFixed(3)}</span></div>
          <div class="card"><span class="card-k">{i18n.t('calibrations.heaters.ki')}</span><span class="card-v mono">{store.heatersState.result.ki.toFixed(3)}</span></div>
          <div class="card"><span class="card-k">{i18n.t('calibrations.heaters.kd')}</span><span class="card-v mono">{store.heatersState.result.kd.toFixed(3)}</span></div>
        </div>
        <button class="btn primary" disabled={busy !== '' || isPrinting} onclick={() => (saveOpen = true)}>
          <Icon name="save" size={14} /> {i18n.t('calibrations.saveConfig')}
        </button>
      {:else if !store.heatersState.tuning}
        <p class="placeholder muted">{i18n.t('calibrations.heaters.run')} <span class="dir-arrow" aria-hidden="true">→</span> {i18n.t('calibrations.heaters.results')}</p>
      {/if}
    </div>
  </div>
</div>

{#if saveOpen}
  <ConfirmDialog
    open={saveOpen}
    title={i18n.t('calibrations.heaters.saveConfirmTitle')}
    message={i18n.t('calibrations.heaters.saveConfirmText')}
    confirmLabel={i18n.t('calibrations.heaters.saveConfig')}
    danger={true}
    onConfirm={confirmSave}
    onClose={() => (saveOpen = false)}
  />
{/if}

<style>
  .pid { display: flex; flex-direction: column; gap: var(--space-sm); }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-md); align-items: start; }
  @container (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  .controls, .results { display: flex; flex-direction: column; gap: var(--space-sm); }
  .field { display: flex; flex-direction: column; gap: var(--space-xs); }
  .label { font-size: var(--font-size-sm); color: var(--text-secondary); display: flex; align-items: baseline; gap: var(--space-xs); }
  .hint { font-size: var(--font-size-sm); color: var(--text-muted); }
  .select, .input {
    background: var(--bg-surface); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);
  }
  .invalid { font-size: var(--font-size-sm); color: var(--danger); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md); border: 1px solid var(--accent);
    border-radius: var(--radius-sm); background: var(--accent);
    color: var(--accent-text); font-size: var(--font-size-sm); cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .live {
    margin-top: var(--space-xs); padding: var(--space-sm); border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: var(--space-xs);
  }
  .live-row { display: flex; justify-content: space-between; font-size: var(--font-size-sm); color: var(--text-secondary); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .results-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); margin: 0; }
  .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-xs); }
  .card {
    background: var(--bg-surface-hover); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); padding: var(--space-sm);
    display: flex; flex-direction: column; gap: 2px;
  }
  .card-k { font-size: var(--font-size-sm); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .card-v { font-size: var(--font-size-md); font-weight: 600; color: var(--text-primary); }
  .placeholder { color: var(--text-muted); font-size: var(--font-size-sm); margin: 0; }
  .placeholder.muted { font-style: italic; }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* Стрелка-указатель зеркалится в RTL */
  .dir-arrow { display: inline-block; }
  :global([dir='rtl']) .dir-arrow { transform: scaleX(-1); }
</style>