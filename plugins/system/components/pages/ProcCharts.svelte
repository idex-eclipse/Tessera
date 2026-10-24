<script lang="ts">
  import { onDestroy } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { useSystem, type ProcPoint, } from '../../use-system.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);

  // ------------------------------------------------------------------
  // Конфигурация графиков (порядок — как в ТЗ)
  // ------------------------------------------------------------------

  interface SeriesDef {
    label: string;
    color: string;
    unit: string;
    get: (p: ProcPoint) => number | null;
  }

  interface ChartDef {
    id: string;
    title: string;
    fixed: boolean; // фиксированный диапазон 0..100
    mcu?: string;   // имя mcu-кольца, если график из mcuRings
    fmt?: (v: number) => string;
    series: SeriesDef[];
  }

  const C = {
    cpu: '#61afef',
    load: '#e5c07b',
    ram: '#40c4ff',
    klipper: '#e06c75',
    moonraker: '#ff6d00',
    mcuLoad: '#e06c75',
    mcuAwake: '#c678dd',
    temp: '#ffab40',
  };

  function buildCharts(): ChartDef[] {
    const cores = store.systemInfo.cpuCount || 0;

    const list: ChartDef[] = [
      {
        id: 'cpu',
        title: i18n.t('system.charts.cpuLoad'),
        fixed: true,
        series: [{ label: 'CPU', color: C.cpu, unit: '%', get: (p) => p.sysCpu }],
      },
      {
        id: 'osload',
        title: i18n.t('system.charts.osLoad'),
        fixed: false,
        fmt: (v) => (cores > 0 ? `${v.toFixed(2)} / ${cores}` : v.toFixed(2)),
        series: [{ label: 'load1', color: C.load, unit: '', get: (p) => p.load1 }],
      },
      {
        id: 'ram',
        title: i18n.t('system.charts.ram'),
        fixed: true,
        series: [
          {
            label: 'RAM',
            color: C.ram,
            unit: '%',
            get: (p) => (p.memUsed != null && p.memTotal ? (p.memUsed / p.memTotal) * 100 : null),
          },
        ],
      },
      {
        id: 'klipper',
        title: i18n.t('system.charts.klipper'),
        fixed: true,
        series: [{ label: 'Klipper', color: C.klipper, unit: '%', get: (p) => p.klipperCpu }],
      },
      {
        id: 'moonraker',
        title: i18n.t('system.charts.moonraker'),
        fixed: true,
        series: [{ label: 'Moonraker', color: C.moonraker, unit: '%', get: (p) => p.mkCpu }],
      },
    ];

    list.push({
      id: 'temp',
      title: i18n.t('system.charts.temp'),
      fixed: false,
      series: [{ label: 'CPU', color: C.temp, unit: '°C', get: (p) => p.cpuTemp }],
    });

    return list;
  }

  // ------------------------------------------------------------------
  // Данные
  // ------------------------------------------------------------------

  function chartPoints(ch: ChartDef): { xs: number[]; cols: Array<Array<number | null>> } {
    const data = store.proc;
    return {
      xs: data.map((p) => p.t),
      cols: ch.series.map((s) => data.map((p) => s.get(p))),
    };
  }

  function hasData(ch: ChartDef): boolean {
    const { cols } = chartPoints(ch);
    return cols.some((col) => col.some((v) => v != null));
  }

  let visible = $derived(buildCharts().filter(hasData));

  function lastValues(ch: ChartDef): Array<{ label: string; color: string; text: string }> {
    const { cols } = chartPoints(ch);
    return ch.series
      .map((s, i) => {
        const col = cols[i] ?? [];
        let last: number | null = null;
        for (let k = col.length - 1; k >= 0; k--) {
          const v = col[k];
          if (v != null) {
            last = v;
            break;
          }
        }
        if (last == null) return null;
        const text = ch.fmt && s.unit === '' ? ch.fmt(last) : `${last.toFixed(2)}${s.unit}`;
        return { label: s.label, color: s.color, text };
      })
      .filter((x): x is { label: string; color: string; text: string } => x !== null);
  }

  // ------------------------------------------------------------------
  // uPlot lifecycle + tooltip (паттерн TemperatureChart)
  // ------------------------------------------------------------------

  interface TooltipRow {
    label: string;
    color: string;
    value: string;
  }

  interface TooltipState {
    chartId: string;
    x: number;
    y: number;
    flipX: boolean;
    rows: TooltipRow[];
  }

  let tooltip = $state<TooltipState | null>(null);
  let containers: Record<string, HTMLDivElement | null> = {};
  let plots: Record<string, uPlot> = {};
  let structureKey = '';
  let themeNonce = $state(0);

  const offTheme = api.onThemeChange(() => {
    themeNonce++;
  });

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      grid: (cs.getPropertyValue('--border-color') || '#333').trim(),
      text: (cs.getPropertyValue('--text-muted') || '#999').trim(),
      family: (cs.getPropertyValue('--font-family') || 'system-ui, sans-serif').trim(),
    };
  }

  function onCursorMove(u: uPlot, ch: ChartDef): void {
    const cursor = u.cursor as { left?: number; top?: number; idx?: number };
    if (cursor.idx == null || cursor.left == null || cursor.top == null) {
      if (tooltip?.chartId === ch.id) tooltip = null;
      return;
    }

    const time = u.data[0]?.[cursor.idx];
    if (time == null) {
      if (tooltip?.chartId === ch.id) tooltip = null;
      return;
    }

    const rows: TooltipRow[] = [];
    for (let i = 0; i < ch.series.length; i++) {
      const s = ch.series[i];
      const val = u.data[i + 1]?.[cursor.idx];
      if (val == null || !s) continue;
      rows.push({
        label: s.label,
        color: s.color,
        value: `${val.toFixed(2)}${s.unit}`,
      });
    }

    if (rows.length === 0) {
      if (tooltip?.chartId === ch.id) tooltip = null;
      return;
    }

    const left = u.over.offsetLeft + cursor.left;
    const top = u.over.offsetTop + cursor.top;
    const width = containers[ch.id]?.clientWidth ?? 0;

    tooltip = {
      chartId: ch.id,
      x: left,
      y: top,
      flipX: left > width * 0.6,
      rows,
    };
  }

  function buildOptions(ch: ChartDef, width: number, height: number): any {
    const c = themeColors();
    const font = `11px ${c.family}`;

    return {
      width,
      height,
      legend: { show: false },
      series: [
        { label: 'time' },
        ...ch.series.map((s) => ({ label: s.label, stroke: s.color, width: 1.5 })),
      ],
      scales: {
        x: { time: true },
        y: { range: ch.fixed ? [0, 100] : undefined },
      },
      axes: [
        { stroke: c.text, grid: { stroke: c.grid, width: 1 }, font },
        {
          stroke: c.text,
          grid: { stroke: c.grid, width: 1 },
          font,
          scale: 'y',
          values: (_u: any, vals: number[]) => vals.map((v) => `${Math.round(v)}${ch.series[0]?.unit ?? ''}`),
        },
      ],
      hooks: {
        setCursor: [(u: uPlot) => onCursorMove(u, ch)],
      },
    };
  }

  function destroyAll(): void {
    for (const p of Object.values(plots)) p.destroy();
    plots = {};
  }

  function recreate(): void {
    destroyAll();
    tooltip = null;

    for (const ch of visible) {
      const el = containers[ch.id];
      if (!el) continue;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 40 || h < 40) continue;

      const pts = chartPoints(ch);
      try {
        plots[ch.id] = new uPlot(buildOptions(ch, w, h), [pts.xs, ...pts.cols] as any, el);
      } catch (e) {
        console.error('[system] chart init failed:', ch.id, e);
      }
    }
  }

  function sync(): void {
    for (const ch of visible) {
      const plot = plots[ch.id];
      if (!plot) continue;
      const pts = chartPoints(ch);
      plot.setData([pts.xs, ...pts.cols] as any);
    }
  }

  $effect(() => {
    void themeNonce;
    structureKey = visible.map((c) => c.id).join('|') + `#${themeNonce}`;
    recreate();
  });

  $effect(() => {
    void store.proc;
    void store.mcus;

    const key = visible.map((c) => c.id).join('|') + `#${themeNonce}`;
    if (key !== structureKey) {
      structureKey = key;
      recreate();
      return;
    }
    sync();
  });

  $effect(() => {
    const ros: ResizeObserver[] = [];
    for (const ch of visible) {
      const el = containers[ch.id];
      if (!el) continue;
      const ro = new ResizeObserver(() => {
        const p = plots[ch.id];
        if (p && el.clientWidth >= 40 && el.clientHeight >= 40) {
          p.setSize({ width: el.clientWidth, height: el.clientHeight });
        }
      });
      ro.observe(el);
      ros.push(ro);
    }
    return () => ros.forEach((ro) => ro.disconnect());
  });

  onDestroy(() => {
    offTheme();
    destroyAll();
  });
</script>

<div class="charts">
  {#each visible as ch (ch.id)}
    <div class="chart-card">
      <div class="chart-head">
        <span class="chart-title">{ch.title}</span>
        <span class="chart-values">
          {#each lastValues(ch) as v (v.label)}
            <span class="val" style="color: {v.color}">{v.text}</span>
          {/each}
        </span>
      </div>

      <div class="chart-box" bind:this={containers[ch.id]}></div>

      {#if tooltip?.chartId === ch.id}
        <div
          class="chart-tooltip"
          class:flip-x={tooltip.flipX}
          style:left="{tooltip.x}px"
          style:top="{tooltip.y}px"
        >
          {#each tooltip.rows as row (row.label)}
            <div class="tooltip-row">
              <span class="tooltip-dot" style:background={row.color}></span>
              <span class="tooltip-label">{row.label}</span>
              <span class="tooltip-value">{row.value}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-md);
  }

  .chart-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    min-width: 0;
  }

  .chart-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
  }

  .chart-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chart-values {
    display: flex;
    gap: var(--space-sm);
    flex-shrink: 0;
  }

  .val {
    font-family: monospace;
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
  }

  .chart-box {
    width: 100%;
    height: 140px;
  }

  .chart-tooltip {
    position: absolute;
    pointer-events: none;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    z-index: 10;
    transform: translate(12px, -50%);
    white-space: nowrap;
  }

  .chart-tooltip.flip-x {
    transform: translate(calc(-100% - 12px), -50%);
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

  .tooltip-label {
    color: var(--text-secondary);
  }

  .tooltip-value {
    margin-inline-start: auto;
    padding-inline-start: var(--space-md);
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
</style>