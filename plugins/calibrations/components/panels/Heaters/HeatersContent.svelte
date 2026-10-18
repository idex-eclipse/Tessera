<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { useHeaterMonitor } from '../../../use-heater.svelte.ts';
  import {
    UPlotChart,
    buildChartData,
    type SeriesDef,
    type ChartData,
  } from '../../../../shared/uplot-core/index.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import { sendMpuNotify } from '../../../../shared/mpu-notify.ts';
  import HeatersHelp from './HeatersPanelHelp.svelte';
  import HeaderHelp from '../../../../shared/header-help/HeaderHelp.svelte';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);
  const monitor = useHeaterMonitor(api);

  // --- параметры из настроек ---
  const DEFAULT_THRESHOLD = 5;
  const SETTLE_SEC = 45;
  const HOLD_SEC = 20;
  const HOLD_PRINT_MULT = 2;
  const COOLDOWN_SEC = 300;

  let threshold = $state(DEFAULT_THRESHOLD);
  let menuOpen = $state(false);

  $effect(() => {
    const read = () => {
      threshold = api.settings.get<number>('deviationThreshold') ?? DEFAULT_THRESHOLD;
    };
    read();
    const off = api.settings.onChange(read);
    const offPrinter = api.onPrinterChange(read);
    return () => {
      off();
      offPrinter();
    };
  });

  function setThreshold(v: number): void {
    threshold = v;
    api.settings.set('deviationThreshold', v);
  }

  // --- меню ---
  $effect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-menu="heaters"]')) menuOpen = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') menuOpen = false;
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  });

  // --- инициализация выбора нагревателя ---
  function defaultTarget(name: string): number {
    const max = store.state.heaterMaxTemps[name] ?? 300;
    return name.toLowerCase() === 'heater_bed' ? Math.min(60, max) : Math.min(200, max);
  }

  $effect(() => {
    const list = store.state.heaters;
    if (list.length === 0) return;
    if (!list.includes(store.heatersState.heater)) {
      store.heatersState.heater = list[0]!;
      store.heatersState.target = defaultTarget(store.heatersState.heater);
    }
  });

  $effect(() => {
    monitor.setHeater(store.heatersState.heater);
  });

  let saveOpen = $state(false);

  function selectHeater(v: string): void {
    store.heatersState.heater = v;
    store.heatersState.target = defaultTarget(v);
  }

  // --- derived ---
  let maxTemp = $derived(store.state.heaterMaxTemps[store.heatersState.heater] ?? 300);
  let targetValid = $derived(store.heatersState.target > 0 && store.heatersState.target <= maxTemp);
  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );

  let pidScript = $derived(
    store.heatersState.heater && targetValid ? gcode.pidCalibrate(store.heatersState.heater, store.heatersState.target) : '',
  );

  async function runPid(): Promise<void> {
    if (!store.heatersState.heater || !targetValid || store.heatersState.tuning || !pidScript) return;
    store.heatersState.result = null;
    store.heatersState.tuning = true;
    try {
      await runGcode(api.moonraker(), pidScript);
    } catch (e) {
      store.heatersState.tuning = false;
      console.error('[calib-debug] runPid: request rejected', e);
    }
  }
  function confirmSave(): void {
    saveOpen = false;
    runGcode(api.moonraker(), gcode.saveConfig())
      .then(() => {
        store.heatersState.result = null;
      })
      .catch((e) => console.error('[calibrations] save failed:', e));
  }

  // --- график ---
  let defs = $derived.by<SeriesDef[]>(() => {
    const s = monitor.sensors[0];
    if (!s) return [];
    return [
      { id: `${s.name}:temp`, kind: 'temp', label: s.displayName, color: s.color, scale: 't' },
      {
        id: `${s.name}:target`,
        kind: 'target',
        label: `${s.displayName} →`,
        color: s.color,
        dash: [6, 4],
        scale: 't',
      },
      {
        id: `${s.name}:power`,
        kind: 'power',
        label: `${s.displayName} %`,
        color: '#40c4ff',
        dash: [4, 3],
        scale: 'p',
      },
    ];
  });

  let data = $derived.by<ChartData>(() => {
    void monitor.tick;
    return buildChartData(monitor.buffers, defs);
  });

  // --- автомат девиации ---
  type DevPhase = 'idle' | 'settle' | 'watch' | 'alert' | 'cooldown';
  let phase = $state<DevPhase>('idle');
  let settleCount = $state(0);
  let holdCount = $state(0);
  let cooldownCount = $state(0);

  $effect(() => {
    void monitor.tick;
    const s = monitor.sensors[0];
    if (!s || s.temperature == null || s.target == null || s.target === 0) {
      phase = 'idle';
      settleCount = 0;
      holdCount = 0;
      return;
    }
    if (store.heatersState.tuning) {
      phase = 'idle';
      return;
    }

    const dev = Math.abs(s.temperature - s.target);
    const holdNeeded = isPrinting ? HOLD_SEC * HOLD_PRINT_MULT : HOLD_SEC;

    if (phase === 'idle' || phase === 'watch') {
      if (dev <= threshold) {
        if (settleCount < SETTLE_SEC) {
          settleCount++;
          phase = 'settle';
        } else {
          phase = 'watch';
          holdCount = 0;
        }
      } else {
        if (phase === 'watch') {
          holdCount++;
          if (holdCount >= holdNeeded) {
            phase = 'alert';
            sendMpuNotify(
              api,
              'error',
              i18n.t('calibrations.heaters.deviationAlert', {
                heater: s.displayName,
                dev: dev.toFixed(1),
                target: s.target.toFixed(0),
              }),
            );
            cooldownCount = 0;
          }
        } else {
          settleCount = 0;
        }
      }
    } else if (phase === 'alert') {
      cooldownCount++;
      if (dev < threshold / 2) {
        phase = 'cooldown';
        cooldownCount = 0;
      } else if (cooldownCount >= COOLDOWN_SEC) {
        phase = 'watch';
        holdCount = holdNeeded;
      }
    } else if (phase === 'cooldown') {
      cooldownCount++;
      if (dev >= threshold) {
        phase = 'watch';
        holdCount = 0;
      } else if (cooldownCount >= COOLDOWN_SEC) {
        phase = 'watch';
        holdCount = 0;
      }
    } else if (phase === 'settle') {
      if (dev > threshold) {
        settleCount = 0;
        phase = 'idle';
      } else if (settleCount >= SETTLE_SEC) {
        phase = 'watch';
      }
    }
  });

  let deviationActive = $derived(phase === 'alert');
  let deviationDev = $derived.by(() => {
    const s = monitor.sensors[0];
    if (!s || s.temperature == null || s.target == null) return 0;
    return Math.abs(s.temperature - s.target);
  });
</script>

<section class="panel">
  <header class="panel-header">
    <span class="panel-title">{i18n.t('calibrations.heaters.title')}</span>
    <div class="header-actions">
      <div class="menu-wrap" data-menu="heaters">
        <button
          class="icon-btn"
          onclick={(e) => {
            e.stopPropagation();
            menuOpen = !menuOpen;
          }}
          title={i18n.t('calibrations.heaters.settings')}
          aria-label={i18n.t('calibrations.heaters.settings')}
        >
          <Icon name="settings" size={14} />
        </button>
        {#if menuOpen}
          <div class="menu" role="menu">
            <label class="menu-item">
              <span class="menu-label">{i18n.t('calibrations.heaters.threshold')}</span>
              <input
                class="input num"
                type="number"
                min="1"
                max="20"
                step="0.5"
                value={threshold}
                onchange={(e) => setThreshold(Number(e.currentTarget.value))}
              />
            </label>
            <p class="menu-hint">{i18n.t('calibrations.heaters.thresholdHint')}</p>
          </div>
        {/if}
      </div>
      <HeaderHelp title={i18n.t('calibrations.heaters.title')}>
        <HeatersHelp />
      </HeaderHelp>
    </div>
  </header>

  <div class="panel-body">
    <div class="grid">
      <div class="controls">
        <label class="field">
          <span class="label">{i18n.t('calibrations.heaters.heater')}</span>
          <select
            class="select"
            value={store.heatersState.heater}
            onchange={(e) => selectHeater(e.currentTarget.value)}
            disabled={store.heatersState.tuning}
          >
            {#each store.state.heaters as h (h)}<option value={h}>{h}</option>{/each}
          </select>
        </label>

        <label class="field">
          <span class="label">
            {i18n.t('calibrations.heaters.target')} <span class="hint">/ max {maxTemp}</span>
          </span>
          <input
            class="input"
            type="number"
            min="1"
            max={maxTemp}
            step="1"
            bind:value={store.heatersState.target}
            disabled={store.heatersState.tuning}
          />
          {#if !targetValid}
            <span class="invalid">
              {i18n.t('calibrations.heaters.invalidTarget', { max: String(maxTemp) })}
            </span>
          {/if}
        </label>

        {#if pidScript}
          <code class="gcode mono" title={pidScript}>{pidScript}</code>
        {/if}

        <div class="btn-row">
          <button
            class="btn primary"
            disabled={!targetValid || store.heatersState.tuning || isPrinting}
            onclick={runPid}
          >
            {#if store.heatersState.tuning}
              <Icon name="loader" size={14} /> {i18n.t('calibrations.heaters.tuning')}
            {:else}
              <Icon name="play" size={14} /> {i18n.t('calibrations.heaters.run')}
            {/if}
          </button>
        </div>

        {#if deviationActive}
          <div class="deviation-alert" role="alert">
            <Icon name="warning" size={14} />
            <span>
              {i18n.t('calibrations.heaters.deviationAlert', {
                heater: monitor.sensors[0]?.displayName ?? store.heatersState.heater,
                dev: deviationDev.toFixed(1),
                target: (monitor.sensors[0]?.target ?? 0).toFixed(0),
              })}
            </span>
          </div>
        {/if}
      </div>

      <div class="results">
        {#if store.heatersState.result}
          <h4 class="results-title">{i18n.t('calibrations.heaters.results')}</h4>
          <div class="cards">
            <div class="card">
              <span class="card-k">{i18n.t('calibrations.heaters.kp')}</span>
              <span class="card-v mono">{store.heatersState.result.kp.toFixed(3)}</span>
            </div>
            <div class="card">
              <span class="card-k">{i18n.t('calibrations.heaters.ki')}</span>
              <span class="card-v mono">{store.heatersState.result.ki.toFixed(3)}</span>
            </div>
            <div class="card">
              <span class="card-k">{i18n.t('calibrations.heaters.kd')}</span>
              <span class="card-v mono">{store.heatersState.result.kd.toFixed(3)}</span>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn primary" disabled={isPrinting} onclick={() => (saveOpen = true)}>
              <Icon name="save" size={14} /> {i18n.t('calibrations.saveConfig')}
            </button>
          </div>
        {:else if !store.heatersState.tuning}
          <p class="placeholder muted">
            {i18n.t('calibrations.heaters.run')} → {i18n.t('calibrations.heaters.results')}
          </p>
        {/if}
      </div>
    </div>

    <div class="chart-wrap">
      {#if monitor.sensors.length > 0}
        <UPlotChart {defs} {data} tick={monitor.tick} height="360px" />
      {:else}
        <p class="placeholder muted">{i18n.t('calibrations.heaters.noData')}</p>
      {/if}
    </div>
  </div>
</section>

{#if saveOpen}
  <ConfirmDialog
    open={saveOpen}
    title={i18n.t('calibrations.heaters.saveConfirmTitle')}
    message={i18n.t('calibrations.heaters.saveConfirmText')}
    confirmLabel={i18n.t('calibrations.saveConfig')}
    danger={true}
    onConfirm={confirmSave}
    onClose={() => (saveOpen = false)}
  />
{/if}

<style>
  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }
  .panel-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
  }
  .panel-body {
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-md);
    align-items: start;
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .controls,
  .results {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
  }
  .hint {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }
  .select,
  .input {
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    padding: var(--space-xs) var(--space-sm);
  }
  .input.num {
    width: 72px;
    padding: 2px var(--space-xs);
  }
  .invalid {
    font-size: var(--font-size-sm);
    color: var(--danger);
  }

  .gcode {
    display: block;
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface-hover-no-override);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }

  .btn-row {
    display: flex;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .deviation-alert {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    border: 1px solid var(--warning);
    border-radius: var(--radius-sm);
    color: var(--warning);
    font-size: var(--font-size-sm);
  }

  .results-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-xs);
  }
  .card {
    background: var(--bg-surface-hover);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-sm);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .card-k {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .card-v {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .chart-wrap {
    width: 100%;
    border-radius: var(--radius-sm);
    padding: var(--space-sm);
    background: transparent;
  }

  .placeholder {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    margin: 0;
  }
  .placeholder.muted {
    font-style: italic;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 10;
    min-width: 220px;
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .menu-item .menu-label {
    flex: 1;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .menu-hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-muted);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>