<script lang="ts">
  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';

  import CameraStream from '../CameraStream.svelte';
  import CameraDialog from '../CameraDialog.svelte';
  import { useCameras } from '../../use-cameras.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useCameras(api);
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
    <CameraStream camera={store.active} />
  {/if}
</div>

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