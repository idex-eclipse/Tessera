<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import { RE_PID, normalizeConsoleLines } from '../../../parse.ts';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);

  let heater = $state('');
  $effect(() => {
    const h = store.state.heaters;
    if (h.length > 0 && !h.includes(heater)) heater = h[0]!;
  });

  let target = $state(200);
  $effect(() => {
    if (!heater) return;
    const max = store.state.heaterMaxTemps[heater] ?? 300;
    const isBed = heater.toLowerCase() === 'heater_bed';
    target = isBed ? Math.min(60, max) : Math.min(200, max);
  });

  let tuning = $state(false);
  let busy = $state('');
  let saveOpen = $state(false);
  let result = $state<{ kp: number; ki: number; kd: number } | null>(null);

  $effect(() => {
    return api.moonraker().onNotify('notify_gcode_response', (params) => {
      for (const line of normalizeConsoleLines(params)) {
        const t = line.trim();
        if (!t) continue;
        const m = RE_PID.exec(t);
        if (m && tuning) {
          result = { kp: +m[1]!, ki: +m[2]!, kd: +m[3]! };
          tuning = false;
          continue;
        }
        if (tuning && t.startsWith('!!')) tuning = false;   // тихо: ошибку несёт центр
      }
    });
  });

  let maxTemp = $derived(store.state.heaterMaxTemps[heater] ?? 300);
  let targetValid = $derived(target > 0 && target <= maxTemp);
  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );
  let currentTemp = $derived(store.state.heaterTemps[heater]?.actual ?? 0);
  let currentTarget = $derived(store.state.heaterTemps[heater]?.target ?? 0);

  async function runPid(): Promise<void> {
    if (!heater || !targetValid || tuning) return;
    result = null;
    tuning = true;
    busy = 'pid';
    try {
      await runGcode(api.moonraker(), gcode.pidCalibrate(heater, target));
    } catch (e) {
      tuning = false;
      console.error('[calibrations] pid failed:', e);
    } finally {
      busy = '';
    }
  }

  function confirmSave(): void {
    saveOpen = false;
    busy = 'save';
    runGcode(api.moonraker(), gcode.saveConfig())
      .then(() => { result = null; })
      .catch((e) => console.error('[calibrations] save failed:', e))
      .finally(() => { busy = ''; });
  }
</script>

<div class="pid">
  <div class="grid">
    <div class="controls">
      <label class="field">
        <span class="label">{i18n.t('calibrations.pid.heater')}</span>
        <select class="select" bind:value={heater} disabled={tuning}>
          {#each store.state.heaters as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      </label>

      <label class="field">
        <span class="label">{i18n.t('calibrations.pid.target')} <span class="hint">/ max {maxTemp}</span></span>
        <input class="input" type="number" min="1" max={maxTemp} step="1" bind:value={target} disabled={tuning} />
        {#if !targetValid}
          <span class="invalid">{i18n.t('calibrations.pid.invalidTarget', { max: String(maxTemp) })}</span>
        {/if}
      </label>

      <button class="btn" onclick={runPid} disabled={!targetValid || tuning || busy !== '' || isPrinting}>
        {#if tuning}
          <Icon name="loader" size={14} /> {i18n.t('calibrations.pid.tuning')}
        {:else}
          <Icon name="play" size={14} /> {i18n.t('calibrations.pid.run')}
        {/if}
      </button>

      {#if tuning}
        <div class="live" role="status" aria-live="polite">
          <div class="live-row"><span>{i18n.t('calibrations.pid.actual')}</span><span class="mono">{currentTemp.toFixed(1)} °C</span></div>
          <div class="live-row"><span>{i18n.t('calibrations.pid.target')}</span><span class="mono">{currentTarget.toFixed(0)} °C</span></div>
        </div>
      {/if}
    </div>

    <div class="results">
      {#if result}
        <h4 class="results-title">{i18n.t('calibrations.pid.results')}</h4>
        <div class="cards">
          <div class="card"><span class="card-k">{i18n.t('calibrations.pid.kp')}</span><span class="card-v mono">{result.kp.toFixed(3)}</span></div>
          <div class="card"><span class="card-k">{i18n.t('calibrations.pid.ki')}</span><span class="card-v mono">{result.ki.toFixed(3)}</span></div>
          <div class="card"><span class="card-k">{i18n.t('calibrations.pid.kd')}</span><span class="card-v mono">{result.kd.toFixed(3)}</span></div>
        </div>
        <button class="btn primary" disabled={busy !== '' || isPrinting} onclick={() => (saveOpen = true)}>
          <Icon name="save" size={14} /> {i18n.t('calibrations.saveConfig')}
        </button>
      {:else if !tuning}
        <p class="placeholder muted">{i18n.t('calibrations.pid.run')} → {i18n.t('calibrations.pid.results')}</p>
      {/if}
    </div>
  </div>
</div>

{#if saveOpen}
  <ConfirmDialog
    open={saveOpen}
    title={i18n.t('calibrations.pid.saveConfirmTitle')}
    message={i18n.t('calibrations.pid.saveConfirmText')}
    confirmLabel={i18n.t('calibrations.pid.saveConfig')}
    danger={true}
    onConfirm={confirmSave}
    onClose={() => (saveOpen = false)}
  />
{/if}

<style>
  .pid { display: flex; flex-direction: column; gap: var(--space-sm); }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-md); align-items: start; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
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
    color: #fff; font-size: var(--font-size-sm); cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
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
</style>