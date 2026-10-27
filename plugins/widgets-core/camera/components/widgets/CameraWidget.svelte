<script lang="ts">
  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import { isRtl } from '../../../../shared/popover-align';

  import CameraStream from '../CameraStream.svelte';
  import CameraDialog from '../CameraDialog.svelte';
  import CameraViewer from '../CameraViewer.svelte';
  import { useCameras } from '../../use-cameras.svelte.ts';
  import { swipeDirection } from '../../camera-utils';

  const api = useWidget();
  const i18n = useI18n();
  const store = useCameras(api);

  let viewerOpen = $state(false);
  let picEl = $state<HTMLElement | null>(null);
  let fps = $state<number | null>(null);

  let multi = $derived(store.enabled.length > 1);
  let index = $derived(store.enabled.findIndex((c) => c.name === store.active?.name));

  // камеру удалили/отключили, пока открыто окно — закрываем его
  $effect(() => {
    if (!store.active) viewerOpen = false;
  });

  function closeViewer(): void {
    viewerOpen = false;
    picEl?.focus();
  }

  // ---------------- свайп (touch / pen) ----------------
  let gesture: { x: number; y: number; t: number } | null = null;
  let swiped = false;

  function onPointerDown(e: PointerEvent): void {
    swiped = false;
    gesture = e.pointerType === 'mouse' || !multi ? null : { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  function onPointerUp(e: PointerEvent): void {
    const g = gesture;
    gesture = null;
    if (!g) return;
    const dir = swipeDirection(e.clientX - g.x, e.clientY - g.y, performance.now() - g.t, isRtl());
    if (!dir) return;
    swiped = true;
    store.step(dir === 'next' ? 1 : -1);
  }

  function onPicClick(): void {
    if (swiped) {
      swiped = false;
      return;
    }
    viewerOpen = true;
  }

  function onPicKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    viewerOpen = true;
  }
</script>

<div class="cam-widget">
  {#if !store.active}
    <div class="no-cam">
      <p>{i18n.t('widgets.camera.noCameras')}</p>
      <button class="btn" onclick={() => store.openAdd()}>
        {i18n.t('widgets.camera.add')}
      </button>
    </div>
  {:else}
    <div class="stage">
      {#if multi}
        <button
          class="nav"
          title={i18n.t('widgets.camera.prevCamera')}
          aria-label={i18n.t('widgets.camera.prevCamera')}
          onclick={() => store.step(-1)}
        >
          <span class="nav-icon"><Icon name="chevron-left" size={18} /></span>
        </button>
      {/if}

      <div
        class="pic"
        role="button"
        tabindex="0"
        aria-label={i18n.t('widgets.camera.expand')}
        title={i18n.t('widgets.camera.expand')}
        bind:this={picEl}
        onclick={onPicClick}
        onkeydown={onPicKey}
        onpointerdown={onPointerDown}
        onpointerup={onPointerUp}
        onpointercancel={() => (gesture = null)}
      >
        <CameraStream camera={store.active} paused={viewerOpen} bind:fps />
        {#if store.active.service === 'iframe'}
          <!-- иначе клик по iframe не доходит до виджета -->
          <div class="hit"></div>
        {/if}
      </div>

      {#if multi}
        <button
          class="nav"
          title={i18n.t('widgets.camera.nextCamera')}
          aria-label={i18n.t('widgets.camera.nextCamera')}
          onclick={() => store.step(1)}
        >
          <span class="nav-icon"><Icon name="chevron-right" size={18} /></span>
        </button>
      {/if}
    </div>

    <div class="caption">
      <bdi class="cap-name" title={store.active.name}>{store.active.name}</bdi>
      {#if fps != null}
        <span class="cap-fps">{Math.round(fps)} {i18n.t('widgets.camera.fpsUnit')}</span>
      {/if}
      {#if multi}
        <span class="cap-idx">{index + 1} / {store.enabled.length}</span>
      {/if}
    </div>
  {/if}
</div>

<CameraViewer
  open={viewerOpen}
  cameras={store.enabled}
  activeName={store.active?.name ?? null}
  onSelect={(name) => store.setActive(name)}
  onClose={closeViewer}
/>

<CameraDialog dialogState={store.dialog} onSave={store.saveCamera} onClose={store.closeDialog} />

<ConfirmDialog
  open={store.toDelete !== null}
  title={i18n.t('widgets.camera.delete')}
  message={i18n.t('widgets.camera.confirmDelete', { name: store.toDelete?.name ?? '' })}
  confirmLabel={i18n.t('widgets.camera.delete')}
  danger={true}
  onConfirm={() => {
    if (store.toDelete) void store.deleteCamera(store.toDelete);
  }}
  onClose={store.closeDelete}
/>

<style>
  :global(mpu-widgets-camera) {
    display: block;
    height: 100%;
  }

  .cam-widget {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: stretch;
    gap: var(--space-xs);
  }

  .pic {
    position: relative;
    flex: 1;
    min-width: 0;
    cursor: pointer;
    /* вертикальный скролл дашборда не перехватываем, горизонтальный жест — наш */
    touch-action: pan-y;
    user-select: none;
    border-radius: var(--radius-sm);
  }

  .pic :global(img) {
    -webkit-user-drag: none;
  }

  .pic:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hit {
    position: absolute;
    inset: 0;
  }

  .nav {
    flex: 0 0 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .nav:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  /* на сенсорных экранах листаем свайпом */
  @media (pointer: coarse) {
    .nav {
      display: none;
    }
  }

  /* prev стоит на inline-start, поэтому в RTL стрелки зеркалим */
  :global([dir='rtl']) .nav-icon {
    display: flex;
    transform: scaleX(-1);
  }

  .caption {
    flex-shrink: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    min-width: 0;
    padding-inline: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .cap-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .cap-fps,
  .cap-idx {
    flex-shrink: 0;
    font-family: monospace;
    font-size: 11px;
    color: var(--text-muted);
  }

  .cap-idx {
    margin-inline-start: auto;
  }

  .no-cam {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .btn {
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .btn:hover {
    background: var(--bg-surface-hover);
  }
</style>