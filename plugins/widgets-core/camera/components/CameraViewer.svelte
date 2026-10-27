<script lang="ts">
  import { useI18n } from '../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../shared/icons/Icon.svelte';

  import type { WebcamItem } from '../use-cameras.svelte.ts';
  import { cycleIndex } from '../camera-utils';
  import CameraStream from './CameraStream.svelte';

  let {
    open,
    cameras,
    activeName,
    onSelect,
    onClose,
  }: {
    open: boolean;
    cameras: WebcamItem[];
    activeName: string | null;
    onSelect: (name: string) => void;
    onClose: () => void;
  } = $props();

  const i18n = useI18n();

  let dialogEl = $state<HTMLElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  let fps = $state<number | null>(null);

  let currentIdx = $derived(Math.max(0, cameras.findIndex((c) => c.name === activeName)));
  let current = $derived(cameras[currentIdx] ?? null);

  function go(delta: number): void {
    if (cameras.length < 2) return;
    const next = cameras[cycleIndex(currentIdx, delta, cameras.length)];
    if (next) onSelect(next.name);
  }

  function onKey(e: KeyboardEvent): void {
    if (!open || e.defaultPrevented || e.isComposing) return;
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      go(-1);
    }
  }

  $effect(() => {
    if (open) dialogEl?.focus();
  });

  // выбранная карточка всегда в зоне видимости списка
  $effect(() => {
    void current?.name;
    if (!open) return;
    listEl
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
</script>

<svelte:window onkeydown={onKey} />

{#if open && current}
  <div class="vw-backdrop" onclick={onClose} role="presentation"></div>

  <div
    class="vw"
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t('widgets.camera.viewer')}
    tabindex="-1"
    bind:this={dialogEl}
  >
    <div class="vw-list" role="listbox" bind:this={listEl}>
      {#each cameras as cam (cam.name)}
        <button
          class="vw-item"
          class:active={cam.name === current.name}
          role="option"
          aria-selected={cam.name === current.name}
          onclick={() => onSelect(cam.name)}
        >
          <span class="vw-thumb">
            <CameraStream camera={cam} variant="thumb" />
          </span>
          <bdi class="vw-name">{cam.name}</bdi>
        </button>
      {/each}
    </div>

    <div class="vw-main">
      <div class="vw-head">
        <bdi class="vw-title" title={current.name}>{current.name}</bdi>
        {#if fps != null}
          <span class="vw-fps">{Math.round(fps)} {i18n.t('widgets.camera.fpsUnit')}</span>
        {/if}
        <button class="vw-btn" title={i18n.t('widgets.camera.close')} onclick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>

      <div class="vw-stage">
        <CameraStream camera={current} bind:fps />
      </div>
    </div>
  </div>
{/if}

<style>
  .vw-backdrop {
    position: fixed;
    inset: 0;
    z-index: 480;
    background: rgba(0, 0, 0, 0.5);
  }

  .vw {
    position: fixed;
    z-index: 481;
    inset: 24px;
    display: flex;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    overflow: hidden;
    outline: none;
  }

  .vw-list {
    flex: 0 0 220px;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm);
    overflow-y: auto;
    border-inline-end: 1px solid var(--border-color);
  }

  .vw-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    text-align: start;
  }

  .vw-item:hover {
    background: var(--bg-surface-hover);
  }

  .vw-item.active {
    border-color: var(--accent);
    background: var(--bg-surface-active);
    color: var(--accent);
  }

  .vw-thumb {
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-app);
  }

  .vw-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .vw-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .vw-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .vw-title {
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

  .vw-fps {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-muted);
  }

  .vw-btn {
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

  .vw-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .vw-stage {
    flex: 1;
    min-height: 0;
    background: var(--bg-app);
  }

  /* узкие экраны: список камер — лентой сверху */
  @media (max-width: 640px) {
    .vw {
      inset: 0;
      border-radius: 0;
      flex-direction: column;
    }

    .vw-list {
      flex: 0 0 auto;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      border-inline-end: none;
      border-bottom: 1px solid var(--border-color);
    }

    .vw-item {
      flex: 0 0 140px;
    }
  }
</style>
