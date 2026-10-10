<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import Icon from '../icons/Icon.svelte';

  let {
    open,
    title = '',
    src = '',
    loading = false,
    onDownload = null,
    onClose,
  }: {
    open: boolean;
    title?: string;
    src?: string;
    loading?: boolean;
    onDownload?: (() => void) | null;
    onClose: () => void;
  } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;

  let imgEl = $state<HTMLImageElement | null>(null);
  let loaded = $state(false);
  let failed = $state(false);

  // zoom: 1 = «вписать в окно»; >1 — масштаб от вписанного размера
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let panning = $state(false);
  let panStart = { x: 0, y: 0, px: 0, py: 0 };

  // новый файл — сброс вида и состояний
  $effect(() => {
    void src;
    zoom = 1;
    pan = { x: 0, y: 0 };
    loaded = false;
    failed = false;
  });

  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 10;

  function zoomBy(f: number): void {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * f));
  }

  function fit(): void {
    zoom = 1;
    pan = { x: 0, y: 0 };
  }

  /** 1:1 — натуральный размер в пикселях относительно вписанного */
  function actual(): void {
    const el = imgEl;
    // clientWidth не зависит от transform → это ширина «вписанного» режима
    if (!el || !el.clientWidth || !el.naturalWidth) return;
    zoom = el.naturalWidth / el.clientWidth;
    pan = { x: 0, y: 0 };
  }

  function onWheel(e: WheelEvent): void {
    if (!loaded || failed) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  function onPointerDown(e: PointerEvent): void {
    if (zoom <= 1 || failed) return;
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!panning) return;
    pan = {
      x: panStart.px + (e.clientX - panStart.x),
      y: panStart.py + (e.clientY - panStart.y),
    };
  }

  function onPointerUp(): void {
    panning = false;
  }

  function onKey(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === 'Escape') onClose();
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(1 / 1.25);
    else if (e.key === '0') fit();
    else if (e.key === '1') actual();
  }

  let transform = $derived(
    `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  );
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div class="iv-backdrop" onclick={onClose} role="presentation"></div>

  <div class="iv" role="dialog" aria-modal="true">
    <div class="iv-head">
      <span class="iv-title" title={title}>{title}</span>

      <div class="iv-actions">
        <button class="iv-btn" title={i18n.t('ft.imgZoomOut')} onclick={() => zoomBy(1 / 1.25)}>
          <Icon name="zoom-out" size={15} />
        </button>
        <span class="iv-zoom">{Math.round(zoom * 100)}%</span>
        <button class="iv-btn" title={i18n.t('ft.imgZoomIn')} onclick={() => zoomBy(1.25)}>
          <Icon name="zoom-in" size={15} />
        </button>
        <button class="iv-btn" title={i18n.t('ft.imgFit')} onclick={fit}>
          <Icon name="maximize" size={15} />
        </button>
        <button class="iv-btn iv-btn-text" title={i18n.t('ft.imgActual')} onclick={actual}>
          1:1
        </button>

        {#if onDownload}
          <button class="iv-btn" title={i18n.t('ft.imgDownload')} onclick={onDownload}>
            <Icon name="download" size={15} />
          </button>
        {/if}

        <button class="iv-btn" title={i18n.t('ft.imgClose')} onclick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>

    <div
      class="iv-stage"
      class:pannable={zoom > 1 && loaded && !failed}
      class:panning
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    >
      {#if failed}
        <div class="iv-state">
          <Icon name="warning" size={20} />
          <span>{i18n.t('ft.imgError')}</span>
        </div>
      {:else if loading || !loaded}
        <div class="iv-state">
          <span class="iv-spinner" aria-hidden="true"></span>
        </div>
      {/if}

      {#if src && !failed}
        <img
          bind:this={imgEl}
          class="iv-img"
          style:transform={transform}
          src={src}
          alt={title}
          draggable="false"
          onload={() => (loaded = true)}
          onerror={() => {
            failed = true;
            loaded = true;
          }}
        />
      {/if}
    </div>
  </div>
{/if}

<style>
  .iv-backdrop {
    position: fixed;
    inset: 0;
    z-index: 499;
    background: rgba(0, 0, 0, 0.5);
  }

  .iv {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
  }

  .iv-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .iv-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .iv-actions {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .iv-btn {
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

  .iv-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .iv-btn-text {
    width: auto;
    padding: 0 var(--space-xs);
    font-family: monospace;
    font-size: 11px;
    font-weight: 700;
  }

  .iv-zoom {
    min-width: 44px;
    text-align: center;
    font-family: monospace;
    font-size: 11px;
    color: var(--text-muted);
  }

  .iv-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-app);
    touch-action: none;
  }

  .iv-stage.pannable {
    cursor: grab;
  }

  .iv-stage.panning {
    cursor: grabbing;
  }

  .iv-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
    /* шахматка под прозрачными PNG */
    background-image:
      linear-gradient(45deg, rgba(128, 128, 128, 0.15) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(128, 128, 128, 0.15) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.15) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.15) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }

  .iv-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    pointer-events: none;
  }

  .iv-spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    animation: iv-spin 0.8s linear infinite;
  }

  @keyframes iv-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>