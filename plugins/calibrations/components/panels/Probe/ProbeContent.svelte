<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import { RE_PROBE_ACC, normalizeConsoleLines } from '../../../parse.ts';
  import ProbeHelp from './ProbePanelHelp.svelte';
  import HeaderHelp from '../../../../shared/header-help/HeaderHelp.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';

  let { compact = false } = $props<{ compact?: boolean }>();

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);

  // ------------------------------------------------------------------
  // состояние
  // ------------------------------------------------------------------

  let eddyChip = $state('');
  $effect(() => {
    const chips = store.state.eddyChips;
    if (chips.length > 0 && !chips.includes(eddyChip)) eddyChip = chips[0]!;
  });

  let probeCount = $state('');
  let busy = $state('');
  let running = false;   // plain-флаг для гейта session-log
  let accuracy = $state<{ max: number; min: number; range: number; avg: number; median: number; stddev: number } | null>(null);
  let log = $state<string[]>([]);

  type SelAction = 'wizard' | 'eddy' | 'endstop' | 'accuracy' | 'load_cell_probe';
  let selected = $state<SelAction>('wizard');

  function pushLog(line: string): void { log = [...log.slice(-49), line]; }

  $effect(() => {
    return api.moonraker().onNotify('notify_gcode_response', (params) => {
      for (const raw of normalizeConsoleLines(params)) {
        const t = raw.trim();
        if (!t) continue;
        const m = RE_PROBE_ACC.exec(t);
        if (m) {
          accuracy = { max: +m[1]!, min: +m[2]!, range: +m[3]!, avg: +m[4]!, median: +m[5]!, stddev: +m[6]! };
          pushLog(t);
          continue;
        }
        if (running || t.startsWith('!!')) pushLog(t);
      }
    });
  });

  // ------------------------------------------------------------------
  // derived
  // ------------------------------------------------------------------

  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );
  let mode = $derived(store.state.probeMode);

  let panelTitle = $derived.by(() => {
    if (mode === 'none') return i18n.t('calibrations.section.probe');
    const base = i18n.t(`calibrations.probe.modes.${mode}`);
    const sec = store.state.probeSectionName;
    if (sec && mode === 'probe' && sec.toLowerCase() !== 'probe') return `[${sec}]`;
    return base;
  });

  let offsetRefs = $derived.by(() => {
    const z = store.state.zOffsets;
    const out: Array<{ key: string; value: number }> = [];
    if (z.probe !== null) out.push({ key: 'calibrations.probe.zOffsetProbe', value: z.probe });
    if (z.bltouch !== null) out.push({ key: 'calibrations.probe.zOffsetBltouch', value: z.bltouch });
    if (z.endstop !== null) out.push({ key: 'calibrations.probe.zOffsetEndstop', value: z.endstop });
    return out;
  });

  /** Доступные действия по режиму: accuracy требует probe-объекта,
   *  endstop-калибровка — только когда проб НЕТ. */
  let actions = $derived.by(() => {
    const list: Array<{ id: SelAction; label: string; show: boolean }> = [
      { id: 'wizard', label: i18n.t('calibrations.probe.startWizard'), show: mode === 'probe' || mode === 'bltouch' },
      { id: 'eddy', label: i18n.t('calibrations.probe.startEddy'), show: mode === 'eddy' },
      { id: 'endstop', label: i18n.t('calibrations.probe.startEndstop'), show: mode === 'endstop' },
      { id: 'accuracy', label: i18n.t('calibrations.probe.accuracy'), show: mode !== 'endstop' && mode !== 'none' },
    ];
    return list.filter((a) => a.show);
  });

  // если текущий выбор стал недоступен (смена режима/принтера) — первый доступный
  $effect(() => {
    if (!actions.some((a) => a.id === selected)) {
      selected = actions[0]?.id ?? 'wizard';
    }
  });

  /** Единый источник строки: превью и отправка используют один derived. */
  let script = $derived.by(() => {
    switch (selected) {
      case 'wizard': return gcode.probeCalibrate();
      case 'eddy': return gcode.eddyCalibrate(eddyChip);
      case 'endstop': return gcode.zEndstopCalibrate();
      case 'accuracy': {
        const n = Number(probeCount);
        return probeCount !== '' && Number.isFinite(n) && n > 0
          ? gcode.probeAccuracy(Math.round(n))
          : gcode.probeAccuracy();
      }
    }
  });

  // ------------------------------------------------------------------
  // действия
  // ------------------------------------------------------------------

  async function run(): Promise<void> {
    if (busy !== '' || isPrinting) return;
    accuracy = null;
    log = [];
    busy = selected;
    running = true;
    try {
      await runGcode(api.moonraker(), script ?? '');
    } catch (e) {
      console.error('[calibrations] probe request failed:', script, e);
    } finally {
      busy = '';
      running = false;
    }
  }
</script>

{#snippet bodyContent()}
  {#if offsetRefs.length > 0}
    <div class="refs-row">
      {#each offsetRefs as ref (ref.key)}
        <span class="ref">{i18n.t(ref.key)}: <b>{ref.value.toFixed(3)}</b></span>
      {/each}
    </div>
  {/if}

  {#if mode === 'eddy' && store.state.eddyChips.length > 1}
    <label class="field">
      <span class="label">{i18n.t('calibrations.probe.chip')}</span>
      <select class="select" bind:value={eddyChip} disabled={busy !== ''}>
        {#each store.state.eddyChips as c (c)}<option value={c}>{c}</option>{/each}
      </select>
    </label>
  {/if}

  <!-- селектор активной команды -->
  <div class="sel-row">
    {#each actions as a (a.id)}
      {#if a.id === 'accuracy'}
        <!-- поле попыток ВНУТРИ кнопки accuracy -->
        <button
          class="sel-btn"
          class:active={selected === 'accuracy'}
          disabled={busy !== ''}
          onclick={() => (selected = 'accuracy')}
        >
          <span>{a.label}</span>
          <input
            class="input num"
            type="number"
            min="1"
            step="1"
            placeholder="10"
            bind:value={probeCount}
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
          />
        </button>
      {:else}
        <button
          class="sel-btn"
          class:active={selected === a.id}
          disabled={busy !== ''}
          onclick={() => (selected = a.id)}
        >
          {a.label}
        </button>
      {/if}
    {/each}
  </div>

  <!-- единая панель отправки: превью + Run -->
  <div class="send-block">
    <code class="gcode mono" title={script}>{script}</code>
    <div class="btn-row">
      <button class="btn primary" disabled={isPrinting || busy !== ''} onclick={run}>
        {#if busy !== ''}
          <Icon name="loader" size={14} /> {i18n.t('calibrations.probe.running')}
        {:else}
          <Icon name="play" size={14} /> {i18n.t('calibrations.probe.run')}
        {/if}
      </button>
    </div>
  </div>

  {#if store.state.manualProbe.isActive}
    <div class="session" role="status">
      <span class="session-chip">
        {i18n.t('calibrations.probe.sessionActive', { z: (store.state.manualProbe.z ?? 0).toFixed(3) })}
      </span>
      <span class="session-hint">{i18n.t('calibrations.probe.sessionHint')}</span>
    </div>
  {/if}

  {#if accuracy}
    <div class="acc-grid">
      <div class="acc-cell"><span class="k">{i18n.t('calibrations.probe.table.max')}</span><span class="v mono">{accuracy.max.toFixed(6)}</span></div>
      <div class="acc-cell"><span class="k">{i18n.t('calibrations.probe.table.min')}</span><span class="v mono">{accuracy.min.toFixed(6)}</span></div>
      <div class="acc-cell"><span class="k">{i18n.t('calibrations.probe.table.range')}</span><span class="v mono">{accuracy.range.toFixed(6)}</span></div>
      <div class="acc-cell"><span class="k">{i18n.t('calibrations.probe.table.avg')}</span><span class="v mono">{accuracy.avg.toFixed(6)}</span></div>
      <div class="acc-cell"><span class="k">{i18n.t('calibrations.probe.table.median')}</span><span class="v mono">{accuracy.median.toFixed(6)}</span></div>
      <div class="acc-cell"><span class="k">{i18n.t('calibrations.probe.table.stddev')}</span><span class="v mono">{accuracy.stddev.toFixed(6)}</span></div>
    </div>
  {/if}

  {#if log.length > 0}
    <div class="log">
      <span class="label">{accuracy ? i18n.t('calibrations.probe.log') : i18n.t('calibrations.probe.rawFallback')}</span>
      <pre>{log.join('\n')}</pre>
    </div>
  {/if}
{/snippet}

{#if compact}
  <div class="probe-compact">
    <span class="compact-title">{panelTitle}</span>
    {@render bodyContent()}
  </div>
{:else}
  <section class="panel">
    <header class="panel-header">
      <span class="panel-title">{panelTitle}</span>
      <div class="header-actions">
        <HeaderHelp title={panelTitle}>
          <ProbeHelp />
        </HeaderHelp>
      </div>
    </header>

    <div class="panel-body">
      {@render bodyContent()}
    </div>
  </section>
{/if}

<style>
  .probe-compact { display: flex; flex-direction: column; gap: var(--space-sm); }
  .compact-title {
    font-size: var(--font-size-md); font-weight: 600; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

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
    display: flex; align-items: center; gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }
  .panel-title {
    flex: 1; min-width: 0;
    font-size: var(--font-size-md); font-weight: 600; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .header-actions { display: flex; align-items: center; gap: var(--space-xs); flex-shrink: 0; }
  .panel-body {
    padding: var(--space-md);
    display: flex; flex-direction: column; gap: var(--space-sm);
  }

  .refs-row { display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap; }
  .ref { font-size: var(--font-size-sm); color: var(--text-muted); }
  .ref b { color: var(--text-secondary); font-weight: 600; font-family: monospace; }

  .field { display: flex; flex-direction: column; gap: var(--space-xs); }
  .label { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .select, .input {
    background: var(--bg-surface); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);
  }
  .input.num { width: 64px; padding: 2px var(--space-xs); }

  /* селектор команд */
  .sel-row { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .sel-btn {
    display: inline-flex; align-items: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: transparent; color: var(--text-secondary);
    font-size: var(--font-size-sm); cursor: pointer;
  }
  .sel-btn:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .sel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sel-btn.active { background: var(--bg-surface-active); color: var(--accent); border-color: var(--accent); }
  .sel-btn.active .input { color: var(--text-primary); }

  /* единая панель отправки */
  .send-block { display: flex; flex-direction: column; gap: var(--space-xs); }
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
  .btn-row { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); background: var(--bg-surface-hover);
    color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }

  .session {
    display: flex; flex-direction: column; gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md); border: 1px dashed var(--accent);
    border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .session-chip { color: var(--accent); font-size: var(--font-size-sm); font-weight: 600; font-family: monospace; }
  .session-hint { color: var(--text-muted); font-size: var(--font-size-sm); }

  .acc-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-xs); }
  @media (max-width: 720px) { .acc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .acc-cell {
    display: flex; flex-direction: column; gap: 2px; padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface-hover); border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  }
  .acc-cell .k { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .acc-cell .v { font-size: var(--font-size-sm); color: var(--text-primary); }

  .log { display: flex; flex-direction: column; gap: var(--space-xs); }
  .log pre {
    margin: 0; max-height: 140px; overflow-y: auto; padding: var(--space-sm);
    background: var(--bg-surface-hover-no-override); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>