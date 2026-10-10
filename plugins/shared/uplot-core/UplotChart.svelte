<script lang="ts">
  /**
   * Generic uPlot-каркас (shared). НЕ импортирует SDK: пригоден страницам,
   * виджетам и любым панелям. Потребитель передаёт defs + data + tick;
   * компонент владеет lifecycle, темами, zoom и tooltip.
   */
  import { onDestroy } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  import { linspace, niceRange } from './math-utils';
  import type { ChartData, SeriesDef } from './chart-data';

  const DIVISIONS = 5;          // 6 тиков на обеих осях
  const MAX_WINDOW = 1200;      // 20 минут
  const MIN_WINDOW = 30;

  let {
    defs,
    data,
    tick,
    height = '400px',
    tooltipFormat = (d: SeriesDef, v: number) =>
      d.kind === 'power' ? `${Math.round(v)}%` : `${v.toFixed(1)}°C`,
  }: {
    defs: SeriesDef[];
    data: ChartData;
    tick: number;
    height?: string;
    tooltipFormat?: (def: SeriesDef, value: number) => string;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);

  let uplot: uPlot | null = null;
  let structureKey = '';
  let themeNonce = $state(0);

  let zoomed = false;
  let zoomMin = 0;
  let zoomMax = 0;
  let wheelTarget: HTMLElement | null = null;
  let dblTarget: HTMLElement | null = null;

  interface TooltipRow {
    label: string;
    color: string;
    value: string;
    dash: boolean;
  }

  interface TooltipState {
    x: number;
    y: number;
    time: number;
    rows: TooltipRow[];
    flipX: boolean;
  }

  let tooltip = $state<TooltipState | null>(null);

  function formatTime(t: number): string {
    return new Date(t * 1000).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function scaleOf(d: SeriesDef): string {
    return d.scale ?? (d.kind === 'power' ? 'p' : 't');
  }

  // ------------------------------------------------------------------
  // Tooltip
  // ------------------------------------------------------------------

  function onCursorMove(u: uPlot): void {
    const cursor = u.cursor as { left?: number; top?: number; idx?: number };
    const idx = cursor.idx;

    if (idx == null || cursor.left == null || cursor.top == null) {
      tooltip = null;
      return;
    }

    const xs = u.data[0];
    const time = xs?.[idx];
    if (time == null) {
      tooltip = null;
      return;
    }

    const rows: TooltipRow[] = [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (!d) continue;

      const seriesData = u.data[i + 1];
      const val = seriesData?.[idx];
      if (val == null) continue;

      rows.push({
        label: d.label,
        color: d.color,
        dash: Boolean(d.dash),
        value: tooltipFormat(d, val),
      });
    }

    if (rows.length === 0) {
      tooltip = null;
      return;
    }

    const left = u.over.offsetLeft + cursor.left;
    const top = u.over.offsetTop + cursor.top;
    const containerWidth = container?.clientWidth ?? 0;
    const flipX = left > containerWidth * 0.6;

    tooltip = { x: left, y: top, time, rows, flipX };
  }

  // ------------------------------------------------------------------
  // Theme (без SDK: следим за data-theme на <html>)
  // ------------------------------------------------------------------

  $effect(() => {
    const mo = new MutationObserver(() => {
      themeNonce++;
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => mo.disconnect();
  });

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      grid: (cs.getPropertyValue('--border-color') || '#333').trim(),
      text: (cs.getPropertyValue('--text-muted') || '#999').trim(),
      family: (cs.getPropertyValue('--font-family') || 'system-ui, sans-serif').trim(),
    };
  }

  // ------------------------------------------------------------------
  // Options
  // ------------------------------------------------------------------

  function buildOptions(seriesDefs: SeriesDef[], width: number, heightPx: number): any {
    const c = themeColors();
    const hasPower = seriesDefs.some((d) => scaleOf(d) === 'p');

    const series: any[] = [{ label: 'time' }];

    for (const d of seriesDefs) {
      series.push({
        label: d.label,
        stroke: d.color,
        width: d.kind === 'temp' ? 1.5 : 1,
        dash: d.dash,
        scale: scaleOf(d),
      });
    }

    const axisFont = `15px ${c.family}`;

    return {
      width,
      height: heightPx,
      legend: { show: false },
      series,
      scales: {
        x: {
          time: true,
          range: (_u: any, dMin: number, dMax: number) => {
            if (zoomed) return [zoomMin, zoomMax];
            return [dMin, dMax];
          },
        },
        t: {
          range: (_u: any, dMin: number, dMax: number) => niceRange(dMin, dMax, DIVISIONS),
        },
        p: { range: [0, 100] },
      },
      axes: [
        // X (время)
        { stroke: c.text, grid: { stroke: c.grid, width: 1 }, font: axisFont },

        // Температура — слева
        {
          stroke: c.text,
          grid: { stroke: c.grid, width: 1 },
          scale: 't',
          font: axisFont,
          splits: (_u: any, _i: number, min: number, max: number) =>
            linspace(min, max, DIVISIONS + 1),
          values: (_u: any, vals: number[]) => vals.map((v) => `${Number(v.toFixed(1))}°`),
        },

        // Мощность — справа, тики на тех же горизонталях
        {
          stroke: c.text,
          grid: { show: false },
          scale: 'p',
          show: hasPower,
          side: 1,
          font: axisFont,
          splits: (_u: any, _i: number, min: number, max: number) =>
            linspace(min, max, DIVISIONS + 1),
          values: (_u: any, vals: number[]) => vals.map((v) => `${Math.round(v)}%`),
        },
      ],
      hooks: {
        setCursor: [(u: uPlot) => onCursorMove(u)],
      },
    };
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  function destroy(): void {
    detachListeners();
    if (uplot) {
      uplot.destroy();
      uplot = null;
    }
    tooltip = null;
  }

  function recreate(): void {
    if (!container) return;

    destroy();

    const width = container.clientWidth;
    const heightPx = container.clientHeight;
    if (width < 50 || heightPx < 50) return;

    try {
      uplot = new uPlot(
        buildOptions(defs, width, heightPx),
        [data.xs, ...data.cols] as any,
        container,
      );
    } catch (e) {
      console.error('[uplot-chart] uPlot init failed:', e);
      uplot = null;
      return;
    }

    attachListeners();
  }

  function syncChart(): void {
    if (defs.length === 0) {
      structureKey = '';
      destroy();
      return;
    }

    const key = defs.map((d) => d.id).join('|') + `#${themeNonce}`;

    if (!uplot || key !== structureKey) {
      structureKey = key;
      recreate();
      return;
    }

    uplot.setData([data.xs, ...data.cols] as any);
    // When not zoomed, x scale auto-follows via range() callback.
  }

  // ------------------------------------------------------------------
  // Zoom: Shift + wheel, dblclick reset
  // ------------------------------------------------------------------

  function onWheel(e: WheelEvent): void {
    const u = uplot;
    if (!u || !e.shiftKey) return;

    e.preventDefault();

    const xs = u.data[0];
    if (!xs || xs.length < 2) return;

    const dataMax = xs[xs.length - 1] as number;
    const dataMin = Math.max(xs[0] as number, dataMax - MAX_WINDOW);

    const cur = u.scales.x;
    const curMin = cur?.min ?? dataMin;
    const curMax = cur?.max ?? dataMax;
    const range = curMax - curMin;

    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    const newRange = Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, range * factor));

    const leftPx = u.cursor.left ?? u.width / 2;
    const anchor = u.posToVal(leftPx, 'x');
    const frac = Math.min(1, Math.max(0, leftPx / u.width));

    let newMin = anchor - newRange * frac;
    let newMax = newMin + newRange;

    if (newMax > dataMax) {
      newMax = dataMax;
      newMin = newMax - newRange;
    }
    if (newMin < dataMin) {
      newMin = dataMin;
      newMax = Math.min(dataMax, newMin + newRange);
    }

    zoomed = newRange < MAX_WINDOW - 0.5 && newRange < dataMax - dataMin - 0.5;
    zoomMin = newMin;
    zoomMax = newMax;

    u.setScale('x', { min: newMin, max: newMax });
  }

  function onDblClick(): void {
    zoomed = false;

    const u = uplot;
    if (!u) return;

    const xs = u.data[0];
    if (xs && xs.length > 1) {
      u.setScale('x', {
        min: xs[0] as number,
        max: xs[xs.length - 1] as number,
      });
    }
  }

  function attachListeners(): void {
    detachListeners();
    if (!uplot) return;

    wheelTarget = uplot.over;
    dblTarget = uplot.over;

    wheelTarget.addEventListener('wheel', onWheel, { passive: false });
    dblTarget.addEventListener('dblclick', onDblClick);
  }

  function detachListeners(): void {
    if (wheelTarget) {
      wheelTarget.removeEventListener('wheel', onWheel);
      wheelTarget = null;
    }
    if (dblTarget) {
      dblTarget.removeEventListener('dblclick', onDblClick);
      dblTarget = null;
    }
  }

  // ------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------

  $effect(() => {
    if (!container) return;

    const ro = new ResizeObserver(() => {
      if (uplot && container) {
        uplot.setSize({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    });

    ro.observe(container);

    return () => ro.disconnect();
  });

  $effect(() => {
    void tick;
    void themeNonce;
    void defs;
    void data;
    syncChart();
  });

  onDestroy(() => {
    destroy();
  });
</script>

<div class="uplot-wrap" style:height={height}>
  <div class="uplot-canvas" bind:this={container}></div>

  {#if tooltip}
    <div
      class="chart-tooltip"
      class:flip-x={tooltip.flipX}
      style:left="{tooltip.x}px"
      style:top="{tooltip.y}px"
    >
      <div class="tooltip-time">{formatTime(tooltip.time)}</div>
      {#each tooltip.rows as row}
        <div class="tooltip-row">
          <span class="tooltip-dot" class:dash={row.dash} style:background={row.color}></span>
          <span class="tooltip-label">{row.label}</span>
          <span class="tooltip-value">{row.value}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .uplot-wrap {
    position: relative;
    width: 100%;
    min-height: 160px;
  }

  .uplot-canvas {
    width: 100%;
    height: 100%;
  }

  .chart-tooltip {
    position: absolute;
    pointer-events: none;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: var(--space-sm) var(--space-md);
    font-size: var(--font-size-sm);
    z-index: 10;
    transform: translate(12px, -50%);
    white-space: nowrap;
  }

  .chart-tooltip.flip-x {
    transform: translate(calc(-100% - 12px), -50%);
  }

  .tooltip-time {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: var(--space-xs);
    font-variant-numeric: tabular-nums;
  }

  .tooltip-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 1px 0;
  }

  .tooltip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tooltip-dot.dash {
    border-radius: 1px;
    height: 3px;
    width: 10px;
  }

  .tooltip-label {
    color: var(--text-secondary);
  }

  .tooltip-value {
    margin-left: auto;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    padding-left: var(--space-md);
  }
</style>