<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import { useBedMesh } from '../../../use-bed-mesh.svelte.ts';
  import { computeStats, deviationColor } from '../../panels/Mesh/mesh-math.ts';
  import {
    sectorCounts,
    sectorMean,
    tickStep,
    fmtSector,
    type SectorBounds,
  } from '../../../bed-mesh-sectors.ts';

  import KlipperNotReady from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useBedMesh(api);
  const klippy = useKlippyState(api);

  /** Минимальный размер клетки сектора в px (требование 3). */
  const MIN_CELL_PX = 50;
  /** Предел глубины zoom — страховка поверх естественного лимита клеток. */
  const MAX_ZOOM_DEPTH = 3;

  const GUTTER_LEFT = 38;
  const GUTTER_BOTTOM = 30;
  const GUTTER_TOP = 12;
  const GUTTER_RIGHT = 14;

  let wrapEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);

  // интерполированная предпочтительна, сырая — как fallback
  let matrix = $derived(
    store.mesh.meshMatrix.length > 0 ? store.mesh.meshMatrix : store.mesh.probedMatrix,
  );
  let stats = $derived(computeStats(matrix));

  // Полные границы стола и текущий view (zoom-стек)
  let fullBounds = $derived.by<SectorBounds | null>(() => {
    if (!store.mesh.meshMin || !store.mesh.meshMax) return null;
    return {
      minX: store.mesh.meshMin[0],
      minY: store.mesh.meshMin[1],
      maxX: store.mesh.meshMax[0],
      maxY: store.mesh.meshMax[1],
    };
  });

  let zoomStack = $state<SectorBounds[]>([]);
  let view = $derived.by<SectorBounds | null>(() =>
    zoomStack.length > 0 ? zoomStack[zoomStack.length - 1]! : fullBounds,
  );

  // Геометрия последнего рендера — для hit-test клика
  let lastGeom = $state<{
    ox: number; oy: number; bedW: number; bedH: number;
    nx: number; ny: number; bounds: SectorBounds;
  } | null>(null);

  $effect(() => {
    const wrap = wrapEl;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  $effect(() => {
    void matrix;
    void stats;
    void view;
    draw();
  });

  $effect(() => {
    return api.onThemeChange(() => draw());
  });

  function cssVar(name: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || 'CanvasText';
  }

  function roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
  ): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function draw(): void {
    const canvas = canvasEl;
    const wrap = wrapEl;
    if (!canvas || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    lastGeom = null;

    if (!store.hasMesh || !stats || !view) return;

    const spanX = view.maxX - view.minX;
    const spanY = view.maxY - view.minY;
    if (spanX <= 0 || spanY <= 0) return;

    // Требование 2: одинаковый масштаб по обеим осям (px на мм)
    const plotW = w - GUTTER_LEFT - GUTTER_RIGHT;
    const plotH = h - GUTTER_TOP - GUTTER_BOTTOM;
    if (plotW < 40 || plotH < 40) return;

    const scale = Math.min(plotW / spanX, plotH / spanY);
    const bedW = spanX * scale;
    const bedH = spanY * scale;

    // Стол прижат к осям: левый и нижний край plot-области
    const ox = GUTTER_LEFT;
    const oy = GUTTER_TOP + (plotH - bedH);
    const axisY = oy + bedH;

    // Требование 3: число клеток из правила минимальной клетки
    const { nx, ny } = sectorCounts(bedW, bedH, MIN_CELL_PX);
    const cellW = bedW / nx;
    const cellH = bedH / ny;

    const muted = cssVar('--text-muted');
    const border = cssVar('--border-color');

    // ---------------- оси ----------------
    ctx.strokeStyle = muted;
    ctx.fillStyle = muted;
    ctx.lineWidth = 1;

    // Y-ось со стрелкой
    ctx.beginPath();
    ctx.moveTo(ox, axisY);
    ctx.lineTo(ox, GUTTER_TOP - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, GUTTER_TOP - 8);
    ctx.lineTo(ox - 3.5, GUTTER_TOP - 1);
    ctx.lineTo(ox + 3.5, GUTTER_TOP - 1);
    ctx.closePath();
    ctx.fill();

    // X-ось со стрелкой
    ctx.beginPath();
    ctx.moveTo(ox, axisY);
    ctx.lineTo(ox + bedW + 6, axisY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox + bedW + 10, axisY);
    ctx.lineTo(ox + bedW + 3, axisY - 3.5);
    ctx.lineTo(ox + bedW + 3, axisY + 3.5);
    ctx.closePath();
    ctx.fill();

    // Имена осей
    ctx.font = '0.925rem ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Y', ox - 20, GUTTER_TOP - 5);
    ctx.fillText('X', ox + bedW + 5 , axisY + 15);

    // Требование 5: тики целыми мм, на полной карте шаг 50
    const step = tickStep(scale, Math.max(spanX, spanY));
    ctx.font = '0.925rem ui-monospace, SFMono-Regular, Menlo, monospace';

    const firstX = Math.ceil(view.minX / step) * step;
    for (let t = firstX; t <= view.maxX + 1e-9; t += step) {
      const px = ox + (t - view.minX) * scale;
      ctx.beginPath();
      ctx.moveTo(px, axisY);
      ctx.lineTo(px, axisY + 4);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(Math.round(t)), px, axisY + 7);
    }

    const firstY = Math.ceil(view.minY / step) * step;
    for (let t = firstY; t <= view.maxY + 1e-9; t += step) {
      const py = axisY - (t - view.minY) * scale;
      ctx.beginPath();
      ctx.moveTo(ox, py);
      ctx.lineTo(ox - 4, py);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(t)), ox - 7, py);
    }

    // ---------------- рамка стола ----------------
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, bedW, bedH);

    // ---------------- секторы ----------------
    // Требование 1: без заливки — окрашены только граница и текст
    const gap = Math.max(2, Math.min(cellW, cellH) * 0.08);

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // мм-границы клетки (row 0 = minY)
        const b: SectorBounds = {
          minX: view.minX + (i * spanX) / nx,
          maxX: view.minX + ((i + 1) * spanX) / nx,
          minY: view.minY + (j * spanY) / ny,
          maxY: view.minY + ((j + 1) * spanY) / ny,
        };
        const mean = sectorMean(matrix, store.mesh.meshMin!, store.mesh.meshMax!, b);

        // px-rect: row 0 рисуется внизу
        const rx = ox + i * cellW + gap;
        const ry = oy + (ny - 1 - j) * cellH + gap;
        const rw = cellW - gap * 2;
        const rh = cellH - gap * 2;
        if (rw <= 1 || rh <= 1) continue;

        const color =
          mean != null ? deviationColor(mean, stats.min, stats.max) : muted;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        roundRectPath(ctx, rx, ry, rw, rh, 4);
        ctx.stroke();

        // Требование 4: среднее отклонение от 0 внутри клетки
        if (mean != null && rw >= 26 && rh >= 16) {
          ctx.fillStyle = color;
          ctx.font = `${Math.round(clampFont(Math.min(rw, rh)))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fmtSector(mean), rx + rw / 2, ry + rh / 2);
        }
      }
    }

    lastGeom = { ox, oy, bedW, bedH, nx, ny, bounds: view };
  }

  function clampFont(cellPx: number): number {
    return Math.max(9, Math.min(13, cellPx * 0.28));
  }

  // ---------------- zoom кликом ----------------
  let zoomable = $derived(
    lastGeom !== null && (lastGeom.nx > 1 || lastGeom.ny > 1) && zoomStack.length < MAX_ZOOM_DEPTH,
  );

  function handleCanvasClick(e: MouseEvent): void {
    const canvas = canvasEl;
    const g = lastGeom;
    if (!canvas || !g) return;
    if (g.nx <= 1 && g.ny <= 1) return; // естественный предел zoom
    if (zoomStack.length >= MAX_ZOOM_DEPTH) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < g.ox || x > g.ox + g.bedW || y < g.oy || y > g.oy + g.bedH) return;

    const i = Math.min(g.nx - 1, Math.floor(((x - g.ox) / g.bedW) * g.nx));
    const jFromTop = Math.min(g.ny - 1, Math.floor(((y - g.oy) / g.bedH) * g.ny));
    const j = g.ny - 1 - jFromTop; // row 0 = minY

    const spanX = g.bounds.maxX - g.bounds.minX;
    const spanY = g.bounds.maxY - g.bounds.minY;
    zoomStack = [
      ...zoomStack,
      {
        minX: g.bounds.minX + (i * spanX) / g.nx,
        maxX: g.bounds.minX + ((i + 1) * spanX) / g.nx,
        minY: g.bounds.minY + (j * spanY) / g.ny,
        maxY: g.bounds.minY + ((j + 1) * spanY) / g.ny,
      },
    ];
  }

  function zoomOut(): void {
    zoomStack = zoomStack.slice(0, -1);
  }

  function resetZoom(): void {
    zoomStack = [];
  }
</script>

<div class="widget">
  {#if !klippy.ready}
    <KlipperNotReady />
  {:else if store.hasMesh && stats && fullBounds}
    <div class="widget-header">
      <span class="profile" title={store.mesh.profileName}>
        {store.mesh.profileName || '—'}
      </span>
      {#if zoomStack.length > 0}
        <button class="zoom-btn" onclick={zoomOut} title={i18n.t('bedMesh.widget.zoomOut')}>
          ← {i18n.t('bedMesh.widget.zoomOut')}
        </button>
        <button class="zoom-btn" onclick={resetZoom} title={i18n.t('bedMesh.widget.resetZoom')}>
          {i18n.t('bedMesh.widget.resetZoom')}
        </button>
      {/if}
    </div>

    <div class="heat-wrap" bind:this={wrapEl}>
      <canvas
        bind:this={canvasEl}
        aria-label={i18n.t('bedMesh.widgetTitle')}
        onclick={handleCanvasClick}
        class:clickable={zoomable}
      ></canvas>
    </div>

    <div class="widget-footer">
      {#if zoomStack.length > 0}
        <span class="zoom-level">
          {i18n.t('bedMesh.widget.zoomLevel')}: {zoomStack.length}
        </span>
      {/if}
      <span class="variance">
        {i18n.t('bedMesh.map.variance')}: {stats.variance.toFixed(3)}
      </span>
    </div>
  {:else}
    <p class="empty">{i18n.t('bedMesh.widget.noMesh')}</p>
  {/if}
</div>

<style>
  .widget {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: var(--space-xs);
  }

  .widget-header {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
    font-size: var(--font-size-sm);
    min-height: 22px;
  }

  .profile {
    font-family: monospace;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .zoom-btn {
    padding: 1px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-xs, 11px);
    cursor: pointer;
    white-space: nowrap;
  }

  .zoom-btn:hover {
    background: var(--bg-surface-active);
  }

  .heat-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover-no-override);
    overflow: hidden;
  }

  .heat-wrap canvas {
    position: absolute;
    inset: 0;
  }

  .heat-wrap canvas.clickable {
    cursor: pointer;
  }

  .widget-footer {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
    flex-shrink: 0;
    font-size: var(--font-size-sm);
  }

  .zoom-level {
    font-family: monospace;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .variance {
    font-family: monospace;
    color: var(--text-muted);
    white-space: nowrap;
    margin-left: auto;
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-md);
    font-size: var(--font-size-sm);
  }
</style>