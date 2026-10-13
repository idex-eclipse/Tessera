<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import { useBedMesh } from '../../../use-bed-mesh.svelte.ts';
  import { computeStats, deviationColor } from '../../panels/Mesh/mesh-math.ts';

  import KlipperNotReady from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useBedMesh(api);
  const klippy = useKlippyState(api);  

  let wrapEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);

  // интерполированная предпочтительна, сырая — как fallback
  let matrix = $derived(
    store.mesh.meshMatrix.length > 0 ? store.mesh.meshMatrix : store.mesh.probedMatrix,
  );
  let stats = $derived(computeStats(matrix));

  let pageHref = $derived(`#/p/${api.printer.id}/calibrations`);

  // resize: canvas абсолютный внутри relative-контейнера —
  // нулевая высота невозможна, dpr учитывается
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
    draw();
  });

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

    if (!store.hasMesh || !stats) return;

    const rows = matrix.length;
    const cols = matrix[0]?.length ?? 0;
    if (rows < 1 || cols < 1) return;

    const pad = 6;
    const cw = (w - pad * 2) / cols;
    const ch = (h - pad * 2) / rows;

    // вид сверху: row 0 = minY рисуется ВНИЗУ (canvas y растёт вниз)
    for (let r = 0; r < rows; r++) {
      const y = pad + (rows - 1 - r) * ch;
      for (let c = 0; c < cols; c++) {
        const v = matrix[r]?.[c] ?? 0;
        ctx.fillStyle = deviationColor(v, stats.min, stats.max);
        ctx.fillRect(pad + c * cw, y, Math.ceil(cw), Math.ceil(ch));
      }
    }
  }
</script>

<div class="widget">
  {#if !klippy.ready}
    <KlipperNotReady />
  {:else if store.hasMesh && stats}
    <div class="heat-wrap" bind:this={wrapEl}>
      <canvas bind:this={canvasEl} aria-label={i18n.t('bedMesh.widgetTitle')}></canvas>
    </div>

    <div class="widget-footer">
      <span class="profile" title={store.mesh.profileName}>
        {store.mesh.profileName || '—'}
      </span>
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

  .heat-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    overflow: hidden;
  }

  .heat-wrap canvas {
    position: absolute;
    inset: 0;
  }

  .widget-footer {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
    flex-shrink: 0;
    font-size: var(--font-size-sm);
  }

  .profile {
    font-family: monospace;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }

  .variance {
    font-family: monospace;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-md);
    font-size: var(--font-size-sm);
  }
</style>