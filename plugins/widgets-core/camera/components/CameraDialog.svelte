<script lang="ts">
  import '../../../shared/input/inputs.css';
  import { useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import { SERVICES, type WebcamItem } from '../use-cameras.svelte.ts';

  let {
    dialogState,
    onSave,
    onClose,
  }: {
    dialogState: { mode: 'add' } | { mode: 'edit'; item: WebcamItem } | null;
    onSave: (item: WebcamItem, isNew: boolean) => void;
    onClose: () => void;
  } = $props();

  const i18n = useI18n();

  const blank: WebcamItem = {
    uid: '', 
    source: 'database',
    name: '',
    location: 'printer',
    service: 'mjpegstreamer-adaptive',
    target_fps: 15,
    target_fps_idle: 5,
    stream_url: '/webcam/?action=stream',
    snapshot_url: '/webcam/?action=snapshot',
    rotation: 0,
    flip_horizontal: false,
    flip_vertical: false,
    enabled: true,
  };

  let draft = $state<WebcamItem>({ ...blank });

  $effect(() => {
    if (!dialogState) return;
    draft = dialogState.mode === 'edit' ? { ...dialogState.item } : { ...blank };
  });

  function submit(): void {
    if (!draft.name.trim()) return;
    onSave({ ...draft, name: draft.name.trim() }, dialogState?.mode === 'add');
  }
</script>

{#if dialogState}
  <div class="dlg-backdrop" onclick={onClose} role="presentation"></div>

  <div class="dlg">
    <div class="dlg-head">
      <span>{dialogState.mode === 'add' ? i18n.t('widgets.camera.add') : i18n.t('widgets.camera.edit')}</span>
      <button class="dlg-x" onclick={onClose}>×</button>
    </div>

    <div class="dlg-body">
      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.enabled')}</span>
        <input type="checkbox" bind:checked={draft.enabled} />
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.name')}</span>
        <input
          class="mpu-input dlg-input"
          type="text"
          bind:value={draft.name}
          disabled={dialogState.mode === 'edit'}
        />
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.flipH')}</span>
        <input type="checkbox" bind:checked={draft.flip_horizontal} />
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.flipV')}</span>
        <input type="checkbox" bind:checked={draft.flip_vertical} />
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.rotation')}</span>
        <select class="dlg-input" bind:value={draft.rotation}>
          <option value={0}>0°</option>
          <option value={90}>90°</option>
          <option value={180}>180°</option>
          <option value={270}>270°</option>
        </select>
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.service')}</span>
        <select class="dlg-input" bind:value={draft.service}>
          {#each SERVICES as s (s)}
            <option value={s}>{i18n.t(`widgets.camera.svc.${s}`)}</option>
          {/each}
        </select>
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.fps')}</span>
        <input class="mpu-input dlg-input" type="number" min="1" bind:value={draft.target_fps} />
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.fpsIdle')}</span>
        <input class="mpu-input dlg-input" type="number" min="1" bind:value={draft.target_fps_idle} />
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.streamUrl')}</span>
        <input class="mpu-input dlg-input" type="text" bind:value={draft.stream_url} />
      </label>

      <label class="dlg-row">
        <span>{i18n.t('widgets.camera.snapshotUrl')}</span>
        <input class="mpu-input dlg-input" type="text" bind:value={draft.snapshot_url} />
      </label>
    </div>

    <div class="dlg-foot">
      <button class="btn ghost" onclick={onClose}>{i18n.t('widgets.camera.cancel')}</button>
      <button class="btn primary" disabled={!draft.name.trim()} onclick={submit}>
        {dialogState.mode === 'add' ? i18n.t('widgets.camera.add') : i18n.t('widgets.camera.save')}
      </button>
    </div>
  </div>
{/if}

<style>
  .dlg-backdrop {
    position: fixed;
    inset: 0;
    z-index: 480;
    background: rgba(0, 0, 0, 0.5);
  }

  .dlg {
    position: fixed;
    z-index: 481;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .dlg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    font-weight: 600;
  }

  .dlg-x {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
  }

  .dlg-body {
    overflow-y: auto;
    padding: var(--space-sm) var(--space-md);
    display: flex;
    flex-direction: column;
  }

  .dlg-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
    padding: var(--space-sm) 0;
    border-bottom: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .dlg-row:last-child {
    border-bottom: none;
  }

  .dlg-input {
    width: 240px;
    flex-shrink: 0;
  }

  .dlg-row input[type='checkbox'] {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
  }

  .dlg-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--border-color);
  }

  .btn {
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 600;
    cursor: pointer;
  }

  .btn.ghost {
    background: transparent;
    color: var(--accent);
  }

  .btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>