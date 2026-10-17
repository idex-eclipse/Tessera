<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types.ts';
  import { type WebcamItem, useCameras} from '../../use-cameras.svelte.ts';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';

  import CameraStream from '../../components/CameraStream.svelte';

  let {
    mpuApi,
    mpuParams,
    params,
  }: {
    mpuApi?: PluginApi;
    mpuParams?: Record<string, string>;
    params?: Record<string, string>;
  } = $props();

  const ctxApi = useWidget();
  const api = mpuApi ?? ctxApi;
  const i18n = useI18n();

  // Инъекция printerId: пробуем оба имени пропа, которыми хост может
  // прокинуть mpuParams через auto-wrap (контракт CE = свойство mpuParams,
  // страницы/виджеты получают prop `params`).
  const injected = mpuParams ?? params;
  const printerId = injected?.printerId ?? api.printer.id;

  if (!injected?.printerId) {
    console.warn(
      '[fleet-camera] printerId NOT injected (mpuParams/params props empty) — ' +
      'fallback to active printer. Check how define-element auto-wrap forwards ' +
      'CE properties into the Svelte component (compare with a chip component).',
    );
  }

  const store = useCameras(api, printerId);

  let selected = $state<string | null>(null);

  let current = $derived(
    store.enabled.find((c) => c.name === selected) ?? store.active,
  );

  /**
   * CameraStream пропускает абсолютные URL как есть, поэтому относительные
   * url веб-камер резолвим ЗДЕСЬ против base ЭТОГО принтера (то же правило
   * со снятием порта, что и внутри CameraStream) и отдаём наверх абсолютные.
   */
  function toAbsolute(u: string): string {
    if (/^https?:\/\//i.test(u)) return u;
    try {
      const base = new URL(api.moonrakerFor(printerId).httpBaseUrl);
      base.port = '';
      return base.origin + (u.startsWith('/') ? u : `/${u}`);
    } catch {
      return u;
    }
  }

  let resolvedCamera = $derived.by<WebcamItem | null>(() => {
    const c = current;
    if (!c) return null;
    return {
      ...c,
      stream_url: toAbsolute(c.stream_url),
      snapshot_url: toAbsolute(c.snapshot_url),
    };
  });
</script>

<div class="fleet-camera">
  {#if store.enabled.length === 0}
    <div class="fleet-camera-empty">
      {i18n.t('fleet.camera.noCameras')}
    </div>
  {:else if resolvedCamera}
    <div class="fleet-camera-stream">
      <CameraStream camera={resolvedCamera} />
    </div>

    {#if store.enabled.length > 1}
      <div class="fleet-camera-switch">
        {#each store.enabled as cam (cam.name)}
          <button
            class="cam-tab"
            class:active={cam.name === resolvedCamera.name}
            onclick={() => (selected = cam.name)}
          >
            {cam.name}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .fleet-camera {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    height: 100%;
    min-height: 0;
  }

  .fleet-camera-stream {
    flex: 1;
    min-height: 0;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-surface);
  }

  .fleet-camera-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
  }

  .fleet-camera-switch {
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .cam-tab {
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cam-tab:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .cam-tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
</style>