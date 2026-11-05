<script lang="ts">
  /**
   * Load cell force graph of the Probe panel (shown for `[load_cell_probe]` only).
   *
   * Two views: "Live" (every sample of `load_cell/dump_force`, falling back to the ~4 Hz
   * status when the Klippy bridge is unavailable) and "Last tap" (the force trace of the
   * latest probing tap from `load_cell_probe/dump_taps`). Modelled on the tessera-ext
   * `pa-tester` graph, drawn with the shared uPlot wrapper.
   *
   * The bulk streams make Klipper push every sample, so they run only while the graph is
   * open and the page is visible.
   */
  import { untrack } from 'svelte';
  import { usePluginApi } from '../../../../../../plugin-sdk/src/svelte/index';
  import { watchSettings } from '../../../../../shared/settings/watch-settings';
  import { UPlotChart, type SeriesDef, type ChartData } from '../../../../../shared/uplot-core/index.ts';
  import { ForceBuffer } from '../../../../lib/load-cell/force-buffer.ts';
  import {
    FILTER_KINDS,
    FILTER_MS_DEFAULT,
    FILTER_MS_MAX,
    FILTER_MS_MIN,
    applyFilter,
    clampFilterMs,
    parseFilterKind,
    type FilterKind,
  } from '../../../../lib/load-cell/force-filter.ts';
  import { MAINS_HZ, mainsFilterSeries, parseMainsHz, type MainsHz } from '../../../../lib/load-cell/mains-filter.ts';
  import type { ForceUnit, TapTrace } from '../../../../lib/load-cell/force-parse.ts';
  import type { LoadCellProbeInfo } from '../../../../lib/load-cell/load-cell-config.ts';
  import {
    startForceSource,
    startTapSource,
    type SourceKind,
    type SourceState,
  } from '../../../../data/force-source.ts';

  let { probes } = $props<{ probes: LoadCellProbeInfo[] }>();

  const api = usePluginApi();
  const i18n = api.i18n;

  const WINDOWS = [30, 60, 120];
  /** The buffer keeps the longest window, so switching windows needs no refetch. */
  const MAX_SECONDS = WINDOWS[WINDOWS.length - 1]!;
  const DEFAULT_SECONDS = 30;
  const EMPTY: ChartData = { xs: [], cols: [[]] };

  const buffer = new ForceBuffer(MAX_SECONDS, 8000);

  // ------------------------------------------------------------------
  // state
  // ------------------------------------------------------------------

  let open = $state(false);
  let seconds = $state(DEFAULT_SECONDS);
  let mode = $state<'live' | 'tap'>('live');
  let paused = $state(false);
  let unit = $state<ForceUnit>('g');
  let source = $state<{ kind: SourceKind; state: SourceState }>({ kind: 'stream', state: 'connecting' });
  let selected = $state('');
  let pageVisible = $state(typeof document === 'undefined' ? true : !document.hidden);
  /** Bumped on printer switch: restarts the streams against the new printer. */
  let printerNonce = $state(0);

  let data = $state.raw<ChartData>(EMPTY);
  let defs = $state.raw<SeriesDef[]>([]);
  let tick = $state(0);
  let stats = $state<{ now: number; min: number; max: number } | null>(null);
  let lastTap = $state.raw<TapTrace | null>(null);
  let seriesColor = $state('');
  /** Colour of the faint raw trace drawn under a filtered one. */
  let rawColor = $state('');
  /** Envelope colours: the lower curve is cold, the upper one hot (theme thermal tokens). */
  let coldColor = $state('');
  let heatColor = $state('');

  // Display filter. The buffer always holds raw samples; the filter is applied when drawing.
  let filter = $state<FilterKind>('raw');
  let filterMs = $state(FILTER_MS_DEFAULT);
  let showRaw = $state(false);
  // Mains hum filter; independent of the display filter and applied before it.
  let mains = $state(false);
  let mainsHz = $state<MainsHz>(50);
  /** False when the filter had nothing to act on (sensor too slow); drives a hint chip. */
  let mainsActive = $state(true);
  /** Snapshot shown while paused, so a filter change does not pull in newer samples. */
  let frozen: { t: number[]; v: number[] } | null = null;

  // a stable key of what the buffer holds: stream and local clocks must never be mixed
  let bufferKey = '';

  // ------------------------------------------------------------------
  // settings (open / window are per-printer UI choices)
  // ------------------------------------------------------------------

  $effect(() => {
    const read = () => {
      open = api.settings.get<boolean>('probe:forceOpen') ?? false;
      const s = api.settings.get<number>('probe:forceSeconds');
      seconds = s !== undefined && WINDOWS.includes(s) ? s : DEFAULT_SECONDS;
      filter = parseFilterKind(api.settings.get<string>('probe:forceFilter'));
      filterMs = clampFilterMs(api.settings.get<number>('probe:forceFilterMs'));
      showRaw = api.settings.get<boolean>('probe:forceRaw') ?? false;
      // untracked: applyMains reads the state it may write
      untrack(() =>
        applyMains(
          api.settings.get<boolean>('probe:forceMains') ?? false,
          parseMainsHz(api.settings.get<number>('probe:forceMainsHz')),
        ),
      );
      schedule();
    };
    read();
    // watchSettings also re-reads on a printer switch (and re-binds to the new printer), so the
    // handler below only drops the previous printer's trace.
    const off = watchSettings(api, read);
    const offPrinter = api.onPrinterChange(() => {
      buffer.clear();
      lastTap = null;
      bufferKey = '';
      printerNonce++;
    });
    return () => {
      off();
      offPrinter();
    };
  });

  function setOpen(v: boolean): void {
    open = v;
    api.settings.set('probe:forceOpen', v);
  }

  function setSeconds(v: number): void {
    seconds = v;
    api.settings.set('probe:forceSeconds', v);
    schedule();
  }

  function setFilter(v: FilterKind): void {
    filter = v;
    api.settings.set('probe:forceFilter', v);
    schedule();
  }

  function setFilterMs(raw: number): void {
    // an empty or invalid field is ignored until the user types a number
    if (!Number.isFinite(raw)) return;
    filterMs = clampFilterMs(raw);
    api.settings.set('probe:forceFilterMs', filterMs);
    schedule();
  }

  function setShowRaw(v: boolean): void {
    showRaw = v;
    api.settings.set('probe:forceRaw', v);
    schedule();
  }

  /**
   * Switches the mains filter. It acts on the incoming stream, so samples already in the
   * buffer keep the old setting: start the trace over rather than mix the two.
   */
  function applyMains(on: boolean, hz: MainsHz): void {
    if (on === mains && hz === mainsHz) return;
    mains = on;
    mainsHz = hz;
    mainsActive = true;
    buffer.clear();
    bufferKey = '';
    if (paused) frozen = { t: [], v: [] };
  }

  function setMains(on: boolean): void {
    applyMains(on, mainsHz);
    api.settings.set('probe:forceMains', on);
    schedule();
  }

  function setMainsHz(hz: MainsHz): void {
    applyMains(mains, hz);
    api.settings.set('probe:forceMainsHz', hz);
    schedule();
  }

  function togglePause(): void {
    paused = !paused;
    frozen = paused ? { t: buffer.times(), v: buffer.values() } : null;
    schedule();
  }

  // keep the selected sensor valid when the config changes
  $effect(() => {
    if (!probes.some((p: LoadCellProbeInfo) => p.section === selected)) selected = probes[0]?.section ?? '';
  });

  $effect(() => {
    const onVis = () => (pageVisible = !document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  // ------------------------------------------------------------------
  // sources
  // ------------------------------------------------------------------

  /** Probe info for the selected section; looked up untracked so a config refresh with an
   *  equal section does not restart the stream. */
  function currentProbe(): LoadCellProbeInfo | null {
    return untrack(() => probes.find((p: LoadCellProbeInfo) => p.section === selected) ?? null);
  }

  $effect(() => {
    void printerNonce;
    if (!open || mode !== 'live' || !pageVisible || !selected) return;
    const probe = currentProbe();
    if (!probe) return;
    // Untracked: the host may report the stream status synchronously while the source is
    // being started, and the sink reads and writes `source`/`unit`. Tracked, that would make
    // this effect depend on state it writes (effect_update_depth_exceeded).
    return untrack(() =>
      startForceSource(api.moonraker(), probe, {
        onSamples(samples, u) {
          const key = `${source.kind}|${u}`;
          if (key !== bufferKey) {
            buffer.clear();
            bufferKey = key;
          }
          unit = u;
          for (const s of samples) buffer.push(s.time, s.value);
          // a paused graph shows its snapshot: no need to rebuild it
          if (!paused) schedule();
        },
        onSource(kind, state) {
          // the kind changes the clock of the samples: start the trace over
          if (kind !== source.kind) {
            buffer.clear();
            bufferKey = '';
          }
          source = { kind, state };
        },
        onMains(active) {
          mainsActive = active;
        },
      }, undefined, () => (mains ? mainsHz : 0)),
    );
  });

  $effect(() => {
    void printerNonce;
    if (!open || !pageVisible || !selected) return;
    const probe = currentProbe();
    if (!probe) return;
    // Untracked for the same reason as the live source above.
    return untrack(() =>
      startTapSource(api.moonraker(), probe, (tap) => {
        lastTap = tap;
        schedule();
      }),
    );
  });

  // ------------------------------------------------------------------
  // drawing: at most one data rebuild per animation frame
  // ------------------------------------------------------------------

  let frame = 0;

  function schedule(): void {
    if (frame || typeof requestAnimationFrame === 'undefined') return;
    frame = requestAnimationFrame(refresh);
  }

  function readColor(): void {
    // canvas cannot use CSS variables: resolve the tokens (and again on theme change)
    const cs = getComputedStyle(document.documentElement);
    seriesColor = cs.getPropertyValue('--accent').trim() || 'currentColor';
    rawColor = cs.getPropertyValue('--text-muted').trim() || 'currentColor';
    coldColor = cs.getPropertyValue('--cool').trim() || 'currentColor';
    heatColor = cs.getPropertyValue('--heat').trim() || 'currentColor';
  }

  /**
   * Series definitions for the current filter. They are set together with `data` (never
   * derived on their own) so the number of series always matches the number of columns:
   * uPlot rejects data whose columns do not line up with its series.
   */
  function makeDefs(withRaw: boolean): SeriesDef[] {
    const out: SeriesDef[] = [];
    const color = seriesColor || 'currentColor';
    // The colour and filter are part of the ids on purpose: UPlotChart rebuilds the plot when
    // the ids change, which is how a theme or filter switch re-applies the stroke colours.
    if (withRaw) {
      out.push({ id: `force-raw:${rawColor}`, kind: 'force', label: i18n.t('calibrations.probe.force.raw'), color: rawColor || 'currentColor', scale: 't' });
    }
    if (filter === 'envelope') {
      const cold = coldColor || 'currentColor';
      const heat = heatColor || 'currentColor';
      out.push({ id: `force-lo:${cold}`, kind: 'force', label: i18n.t('calibrations.probe.force.envelopeMin'), color: cold, scale: 't' });
      out.push({ id: `force-hi:${heat}`, kind: 'force', label: i18n.t('calibrations.probe.force.envelopeMax'), color: heat, scale: 't' });
    } else {
      const label = filter === 'raw' ? i18n.t('calibrations.probe.force.title') : i18n.t('calibrations.probe.force.filtered');
      out.push({ id: `force:${color}:${filter}`, kind: 'force', label, color, scale: 't' });
    }
    return out;
  }

  /** Filters one series and publishes it (and its series definitions) to the chart. */
  function show(xs: number[], ys: number[], shiftX: number): { lo: number; hi: number } {
    const f = applyFilter(filter, filterMs, xs, ys);
    const withRaw = showRaw && filter !== 'raw';
    const x = shiftX === 0 ? xs : xs.map((t) => t - shiftX);
    defs = makeDefs(withRaw);
    data = { xs: x, cols: withRaw ? [ys, ...f.cols] : f.cols };
    // extremes of the drawn trace: the lower curve and the upper curve (they coincide unless envelope)
    const lower = f.cols[0]!;
    const upper = f.cols[f.cols.length - 1]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < lower.length; i++) {
      if (lower[i]! < lo) lo = lower[i]!;
      if (upper[i]! > hi) hi = upper[i]!;
    }
    return { lo, hi };
  }

  function showEmpty(): void {
    defs = makeDefs(false);
    data = EMPTY;
  }

  function refresh(): void {
    frame = 0;
    if (!seriesColor) readColor();
    if (mode === 'tap') {
      if (lastTap) {
        let ys = lastTap.force;
        if (mains) {
          // a tap arrives unbinned at the sensor's own rate, so the filter can act on it directly
          const m = mainsFilterSeries(mainsHz, lastTap.times, ys);
          ys = m.values;
          mainsActive = m.active;
        }
        show(lastTap.times, ys, 0);
      } else showEmpty();
      tick++;
      return;
    }
    const t = frozen?.t ?? buffer.times();
    const v = frozen?.v ?? buffer.values();
    if (t.length === 0) {
      showEmpty();
      stats = null;
      tick++;
      return;
    }
    // x is "seconds before the newest sample": the printer clock has no meaning to the user.
    // The filter runs on the absolute times so its bins stay put while the window scrolls.
    const newest = t[t.length - 1]!;
    const r = show(t, v, newest);
    stats = { now: v[v.length - 1]!, min: r.lo, max: r.hi };
    tick++;
  }

  $effect(() => {
    // redraw on view / pause changes
    void mode;
    void open;
    schedule();
  });

  $effect(() => {
    readColor();
    const mo = new MutationObserver(() => {
      readColor();
      schedule();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
  });

  function clear(): void {
    buffer.clear();
    lastTap = null;
    stats = null;
    frozen = paused ? { t: [], v: [] } : null;
    showEmpty();
    tick++;
  }

  // ------------------------------------------------------------------
  // derived view
  // ------------------------------------------------------------------

  let unitLabel = $derived(
    unit === 'g' ? i18n.t('calibrations.probe.force.unitG') : i18n.t('calibrations.probe.force.unitCounts'),
  );
  // tap traces are always grams; the live trace falls back to raw counts when uncalibrated
  let viewUnitG = $derived(mode === 'tap' || unit === 'g');

  let xRange = $derived<[number, number] | null>(mode === 'live' ? [-seconds, 0] : null);

  function fmt(v: number): string {
    return viewUnitG ? v.toFixed(1) : String(Math.round(v));
  }
  const tooltipFormat = (_d: SeriesDef, v: number): string => `${fmt(v)} ${viewUnitG ? i18n.t('calibrations.probe.force.unitG') : unitLabel}`;
  const formatX = (x: number): string => (mode === 'tap' ? `${Math.round(x * 1000)} ms` : `${x.toFixed(1)} s`);
  const formatY = (v: number): string => String(Number(v.toFixed(1)));

  function filterName(k: FilterKind): string {
    switch (k) {
      case 'raw': return i18n.t('calibrations.probe.force.filterRaw');
      case 'average': return i18n.t('calibrations.probe.force.filterAverage');
      case 'moving': return i18n.t('calibrations.probe.force.filterMoving');
      case 'median': return i18n.t('calibrations.probe.force.filterMedian');
      case 'envelope': return i18n.t('calibrations.probe.force.filterEnvelope');
    }
  }

  let hasPoints = $derived(data.xs.length > 0);
  let emptyText = $derived.by(() => {
    if (mode === 'tap') return i18n.t('calibrations.probe.force.noTap');
    return source.state === 'connecting'
      ? i18n.t('calibrations.probe.force.connecting')
      : i18n.t('calibrations.probe.force.noData');
  });
  let sourceLabel = $derived.by(() => {
    if (source.state === 'unavailable') return i18n.t('calibrations.probe.force.sourceUnavailable');
    return source.kind === 'stream'
      ? i18n.t('calibrations.probe.force.sourceStream')
      : i18n.t('calibrations.probe.force.sourceStatus');
  });
</script>

<section class="force">
  <div class="force-head">
    <span class="force-title">{i18n.t('calibrations.probe.force.title')}</span>
    <button class="btn" aria-expanded={open} onclick={() => setOpen(!open)}>
      {open ? i18n.t('calibrations.probe.force.hide') : i18n.t('calibrations.probe.force.show')}
    </button>
  </div>

  {#if open}
    <div class="toolbar">
      {#if probes.length > 1}
        <label class="field">
          <span class="label">{i18n.t('calibrations.probe.force.sensor')}</span>
          <select class="select" bind:value={selected}>
            {#each probes as p (p.section)}<option value={p.section}>{p.section}</option>{/each}
          </select>
        </label>
      {/if}

      <div class="seg" role="group" aria-label={i18n.t('calibrations.probe.force.title')}>
        <button class="btn" class:active={mode === 'live'} aria-pressed={mode === 'live'} onclick={() => (mode = 'live')}>
          {i18n.t('calibrations.probe.force.live')}
        </button>
        <button class="btn" class:active={mode === 'tap'} aria-pressed={mode === 'tap'} onclick={() => (mode = 'tap')}>
          {i18n.t('calibrations.probe.force.tap')}
        </button>
      </div>

      {#if mode === 'live'}
        <span class="chip source" class:bad={source.state === 'unavailable'}>{sourceLabel}</span>
      {/if}
    </div>

    <!-- filter row: wraps on narrow screens; the number field stays LTR in RTL locales -->
    <div class="toolbar">
      <label class="field">
        <span class="label">{i18n.t('calibrations.probe.force.filter')}</span>
        <select class="select" value={filter} onchange={(e) => setFilter(parseFilterKind(e.currentTarget.value))}>
          {#each FILTER_KINDS as k (k)}
            <option value={k}>{filterName(k)}</option>
          {/each}
        </select>
      </label>
      {#if filter !== 'raw'}
        <label class="field">
          <span class="label">{i18n.t('calibrations.probe.force.filterMs')}, {i18n.t('calibrations.probe.force.msUnit')}</span>
          <input
            class="select num"
            type="number"
            dir="ltr"
            inputmode="numeric"
            min={FILTER_MS_MIN}
            max={FILTER_MS_MAX}
            step="10"
            value={filterMs}
            onchange={(e) => setFilterMs(e.currentTarget.valueAsNumber)}
          />
        </label>
        <label class="check">
          <input type="checkbox" checked={showRaw} onchange={(e) => setShowRaw(e.currentTarget.checked)} />
          <span>{i18n.t('calibrations.probe.force.showRaw')}</span>
        </label>
      {/if}
      <label class="check">
        <input type="checkbox" checked={mains} onchange={(e) => setMains(e.currentTarget.checked)} />
        <span>{i18n.t('calibrations.probe.force.mains')}</span>
      </label>
      {#if mains}
        <select
          class="select end"
          aria-label={i18n.t('calibrations.probe.force.mainsHz')}
          value={mainsHz}
          onchange={(e) => setMainsHz(parseMainsHz(Number(e.currentTarget.value)))}
        >
          {#each MAINS_HZ as hz (hz)}
            <option value={hz}>{i18n.t('calibrations.probe.force.hz', { n: hz })}</option>
          {/each}
        </select>
        {#if !mainsActive}<span class="chip bad end">{i18n.t('calibrations.probe.force.mainsLowRate')}</span>{/if}
      {/if}
    </div>

    {#if mode === 'live' && stats}
      <!-- numbers are inherently LTR: keep them isolated in RTL locales -->
      <div class="stats" dir="ltr">
        <span class="chip">{i18n.t('calibrations.probe.force.now')} <b>{fmt(stats.now)}</b> {unitLabel}</span>
        <span class="chip">{i18n.t('calibrations.probe.force.min')} <b>{fmt(stats.min)}</b></span>
        <span class="chip">{i18n.t('calibrations.probe.force.max')} <b>{fmt(stats.max)}</b></span>
      </div>
    {/if}

    <div class="chart">
      <!-- the plot itself is not mirrored in RTL (time runs left to right); the overlay text is -->
      <div dir="ltr">
      <UPlotChart
        {defs}
        {data}
        {tick}
        height="clamp(180px, 35dvh, 280px)"
        xTime={false}
        {xRange}
        {formatX}
        {formatY}
        {tooltipFormat}
      />
      </div>
      {#if !hasPoints}<div class="empty">{emptyText}</div>{/if}
    </div>

    <div class="toolbar">
      {#if mode === 'live'}
        <div class="seg" role="group" aria-label={i18n.t('calibrations.probe.force.window')}>
          {#each WINDOWS as w (w)}
            <button class="btn" class:active={seconds === w} aria-pressed={seconds === w} onclick={() => setSeconds(w)}>
              {i18n.t('calibrations.probe.force.seconds', { n: w })}
            </button>
          {/each}
        </div>
        <button class="btn" onclick={togglePause}>
          {paused ? i18n.t('calibrations.probe.force.resume') : i18n.t('calibrations.probe.force.pause')}
        </button>
      {/if}
      <button class="btn" onclick={clear}>{i18n.t('calibrations.probe.force.clear')}</button>
    </div>
  {/if}
</section>

<style>
  .force { display: flex; flex-direction: column; gap: var(--space-sm); }
  .force-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); flex-wrap: wrap; }
  .force-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); min-width: 0; overflow-wrap: anywhere; }

  /* wrap on narrow screens: localized labels can be much longer than the English ones */
  .toolbar, .stats { display: flex; align-items: center; gap: var(--space-xs); flex-wrap: wrap; }
  .seg { display: inline-flex; gap: var(--space-xs); flex-wrap: wrap; }

  .field { display: flex; flex-direction: column; gap: var(--space-xs); }
  .label { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .select {
    background: var(--bg-surface); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);
    min-height: 36px;
  }

  .num { inline-size: 7rem; }
  /* controls without a caption sit on the same baseline as the captioned fields */
  .end { align-self: flex-end; }
  .check { display: inline-flex; align-items: center; gap: var(--space-xs); min-height: 36px; font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer; align-self: flex-end; }

  /* min-height keeps touch targets comfortable; nothing depends on hover */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
    min-height: 36px; padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: var(--bg-surface-hover); color: var(--text-primary);
    font-size: var(--font-size-sm); cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn.active { background: var(--bg-surface-active); color: var(--accent); border-color: var(--accent); }

  .chip {
    display: inline-flex; align-items: baseline; gap: var(--space-xs);
    padding: 2px var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: var(--bg-surface-hover); color: var(--text-secondary);
    font-size: var(--font-size-sm); font-variant-numeric: tabular-nums;
  }
  .chip b { color: var(--text-primary); font-weight: 600; }
  .chip.bad { color: var(--warning); border-color: var(--warning); }

  .chart { position: relative; min-width: 0; }
  .empty {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: var(--space-md); text-align: center; pointer-events: none;
    color: var(--text-muted); font-size: var(--font-size-sm);
  }
</style>
