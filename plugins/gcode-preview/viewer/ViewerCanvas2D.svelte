<script lang="ts">
  import type { ParsedGcode } from './parse-gcode';
  import { extruderRgb, typeRgb } from './colors';
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';
  import { useKlippyState } from '../../shared/klippy-state/use-klippy-state.svelte.ts';
  import Icon from '../../shared/icons/Icon.svelte';
  import { useExcludeObjects } from '../../shared/exclude-objects/use-exclude-objects.svelte.ts';
  import ConfirmDialog from '../../shared/confirm-dialog.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const klippy = useKlippyState(api);
  const excludeStore = useExcludeObjects(api);

  let {
    parsed,
    layer,
    showTravel = false,
    colorMode = 'type',
    showPrev = false,
    showNext = false,
    showBounds = true,
    interactive = true,
    progressSeg = null,
  }: {
    parsed: ParsedGcode;
    layer: number;
    showTravel?: boolean;
    colorMode?: 'extruder' | 'type';
    showPrev?: boolean;
    showNext?: boolean;
    showBounds?: boolean;
    interactive?: boolean;
    progressSeg?: number | null;
  } = $props();

  const TRAVEL_COLOR = 'rgba(128, 128, 128, 0.35)';
  const BOUNDS_COLOR = 'rgba(138, 168, 255, 0.6)';

  let wrapEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);

  let wrapSize = $state({ w: 0, h: 0 });

  $effect(() => {
    const wrap = wrapEl;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      wrapSize = { w: wrap.clientWidth, h: wrap.clientHeight };
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  // Path2D строятся ЛЕНИВО только для показанных слоёв + маленький LRU
  let pathCache = new Map<number, { ext: Path2D[]; trav: Path2D }>();

  $effect(() => {
    void parsed;
    pathCache = new Map();
    zoom = 1; panX = 0; panY = 0;
  });

  function getLayerPaths(l: number): { ext: Path2D[]; trav: Path2D } {
    const hit = pathCache.get(l);
    if (hit) return hit;

    const start = parsed.layerStart[l] ?? 0;
    const end = parsed.layerStart[l + 1] ?? start;
    const pos = parsed.positions;

    const ext = Array.from({ length: groupCount() }, () => new Path2D());
    const trav = new Path2D();

    for (let i = start; i < end; i++) {
      const o = i * 6;
      const p = parsed.kinds[i] === 1 ? (ext[groupOf(i)] ?? ext[0]!) : trav;
      p.moveTo(pos[o]!, pos[o + 1]!);
      p.lineTo(pos[o + 3]!, pos[o + 4]!);
    }

    const entry = { ext, trav };
    pathCache.set(l, entry);
    if (pathCache.size > 12) {
      const oldest = pathCache.keys().next().value;
      if (oldest !== undefined) pathCache.delete(oldest);
    }
    return entry;
  }

  let objectPaths = $derived.by(() => {
    return displayObjects.map((o) => {
      const p = new Path2D();
      let first = true;
      for (const pt of o.polygon) {
        if (first) { p.moveTo(pt.x, pt.y); first = false; }
        else p.lineTo(pt.x, pt.y);
      }
      p.closePath();
      return { path: p, obj: o };
    });
  });

  $effect(() => {
    void layer; void showTravel; void colorMode; void showPrev; void showNext;
    void showBounds; void objectPaths; void zoom; void panX; void panY; void progressSeg;
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

    const { bounds } = parsed;
    const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
    const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
    const fit = Math.min((w - 24) / bw, (h - 24) / bh);
    const s = fit * zoom;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + panX, h / 2 + panY);
    ctx.scale(s, -s);
    ctx.translate(-cx, -cy);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const layerCount = parsed.layerZ.length;
    const shown: number[] = [layer];
    if (showPrev && layer - 1 >= 0) shown.push(layer - 1);
    if (showNext && layer + 1 < layerCount) shown.push(layer + 1);

    if (showTravel) {
      ctx.strokeStyle = TRAVEL_COLOR;
      ctx.lineWidth = 0.75 / s;
      for (const l of shown) ctx.stroke(getLayerPaths(l).trav);
    }

    ctx.lineWidth = 1.5 / s;
    for (const l of shown) {
      const gc = groupCount();
      ctx.globalAlpha = l === layer ? 1 : 0.35;
      const paths = getLayerPaths(l);
      if (colorMode === 'extruder') {
        for (let g = 0; g < gc; g++) { ctx.strokeStyle = groupCss(g); ctx.stroke(paths.ext[g]!); }
      } else {
        for (let g = 0; g < gc; g++) { ctx.strokeStyle = groupCss(g); ctx.stroke(paths.ext[g]!); }
      }
    }
    ctx.globalAlpha = 1;

    if (progressSeg != null) {
        const pos = parsed.positions;
        const p = new Path2D();
        for (const l of shown) {
            const a = parsed.layerStart[l] ?? 0;
            const b = Math.min(parsed.layerStart[l + 1] ?? a, progressSeg + 1);
            for (let i = a; i < b; i++) {
            if (parsed.kinds[i] !== 1) continue;
            const o = i * 6;
            p.moveTo(pos[o]!, pos[o + 1]!);
            p.lineTo(pos[o + 3]!, pos[o + 4]!);
            }
        }
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / s;
        ctx.stroke(p);
    }

    if (showBounds && objectPaths.length > 0) {
      ctx.lineWidth = 1.5 / s;
      for (const { path, obj } of objectPaths) {
        if (obj.excluded) {
          ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
          ctx.fillStyle = 'rgba(128, 128, 128, 0.08)';
        } else if (obj.current) {
          ctx.strokeStyle = 'rgba(255, 180, 0, 0.9)';
          ctx.fillStyle = 'rgba(255, 180, 0, 0.08)';
        } else {
          ctx.strokeStyle = BOUNDS_COLOR;
          ctx.fillStyle = 'rgba(138, 168, 255, 0.05)';
        }
        ctx.fill(path);
        ctx.stroke(path);
      }
    }
  }

  let displayObjects = $derived(excludeStore.objects);

  // подтверждение исключения: клик паркует имя, команда уходит только из диалога
  let confirmExclude = $state<string | null>(null);

  function doExclude(): void {
    if (confirmExclude) void excludeStore.exclude(confirmExclude);
    confirmExclude = null;
  }

  function centroidOf(poly: Array<{ x: number; y: number }>): { x: number; y: number } {
    if (poly.length === 0) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p.x; sy += p.y; }
    return { x: sx / poly.length, y: sy / poly.length };
  }

  let buttonPositions = $derived.by(() => {
    if (!wrapSize.w || !wrapSize.h) return [];
    const w = wrapSize.w;
    const h = wrapSize.h;
    if (!w || !h) return [];
    const { bounds } = parsed;
    const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
    const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
    const fit = Math.min((w - 24) / bw, (h - 24) / bh);
    const s = fit * zoom;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    return displayObjects.map((o) => ({
      name: o.name,
      excluded: o.excluded,
      x: (o.center.x - cx) * s + w / 2 + panX,
      y: -(o.center.y - cy) * s + h / 2 + panY,
    }));
  });

  let canExclude = $derived(klippy.ready && excludeStore.available);

  // ------------------------------------------------------------------
  // pan / zoom
  // ------------------------------------------------------------------

  let dragging = false;
  let lastPX = 0;
  let lastPY = 0;

  function onPointerDown(e: PointerEvent): void {
    if (!interactive) return;
    dragging = true;
    lastPX = e.clientX;
    lastPY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    panX += e.clientX - lastPX;
    panY += e.clientY - lastPY;
    lastPX = e.clientX;
    lastPY = e.clientY;
  }

  function onPointerUp(): void {
    dragging = false;
  }

  function onWheel(e: WheelEvent): void {
    if (!interactive) return;
    e.preventDefault();
    zoom = Math.min(32, Math.max(0.2, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  }

  function groupCount(): number {
    return colorMode === 'extruder' ? parsed.extruderCount : parsed.typeNames.length;
  }
  function groupOf(i: number): number {
    return colorMode === 'extruder' ? (parsed.extruders[i] ?? 0) : (parsed.segTypes[i] ?? 0);
  }
  function groupCss(g: number): string {
    const [r, gg, b] = colorMode === 'extruder' ? extruderRgb(g) : typeRgb(g);
    return `rgb(${r}, ${gg}, ${b})`;
  }
</script>

<div class="canvas-wrap" bind:this={wrapEl}>
  <canvas
    bind:this={canvasEl}
    class:interactive
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onwheel={onWheel}
  ></canvas>

  {#each buttonPositions as bp (bp.name)}
    <button
      class="obj-btn"
      class:excluded={bp.excluded}
      disabled={!canExclude || bp.excluded}
      title={bp.excluded
        ? i18n.t('gcodePreview.excluded')
        : !canExclude
          ? i18n.t('common.klipperNotReady')
          : i18n.t('gcodePreview.excludeObject', { name: bp.name })}
      style:left="{bp.x}px"
      style:top="{bp.y}px"
      onclick={(e) => {
        e.stopPropagation();
        if (canExclude && !bp.excluded) confirmExclude = bp.name;
      }}
    >
      <Icon name="x" size={12} />
    </button>
  {/each}
</div>

<ConfirmDialog
  open={confirmExclude !== null}
  title={i18n.t('gcodePreview.excludeConfirmTitle')}
  message={i18n.t('gcodePreview.excludeConfirmMessage', { name: confirmExclude ?? '' })}
  confirmLabel={i18n.t('gcodePreview.excludeConfirmLabel')}
  danger={true}
  onConfirm={doExclude}
  onClose={() => (confirmExclude = null)}
/>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
  }

  .canvas-wrap canvas { position: absolute; inset: 0; touch-action: none; }
  .canvas-wrap canvas.interactive { cursor: grab; }
  .canvas-wrap canvas.interactive:active { cursor: grabbing; }

    .obj-btn {
    position: absolute;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--warning) 60%, transparent);
    border-radius: 50%;
    background: var(--bg-surface);
    color: var(--warning);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    box-shadow: var(--shadow-sm);
    z-index: 2;
    pointer-events: auto;
  }

  .obj-btn:hover:not(:disabled) {
    background: var(--warning);
    color: #fff;
  }

  .obj-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .obj-btn.excluded {
    background: var(--bg-surface-hover);
    color: var(--text-muted);
    border-color: var(--border-color);
  }
</style>