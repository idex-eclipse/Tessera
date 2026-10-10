<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../shared/icons/Icon.svelte';

  import { useBedMesh } from '../../use-bed-mesh.svelte.ts';
  import { bedMeshUiState } from '../../bed-mesh-ui-state.svelte.ts';
  import { gcode, runGcode } from '../../commands.ts';

  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useBedMesh(api);
  const klippy = useKlippyState(api); 

  let busy = $state(false);

  // видимость — решение плагина: флаг UI + наличие результатов
  let open = $derived(bedMeshUiState.screwsOverlayOpen && store.screws.hasResults && klippy.ready);

  function close(): void {
    bedMeshUiState.screwsOverlayOpen = false;
  }

  async function recalc(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await runGcode(api.moonraker(), gcode.screwsTiltCalculate);
      await store.refresh();
    } catch (e) {
      console.error('[bed-mesh] screws recalc failed', e);
    } finally {
      busy = false;
    }
  }
</script>

{#if open}
  <div class="overlay-backdrop" onclick={close} role="presentation"></div>

  <div
    class="overlay-panel"
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t('bedMesh.screws.title')}
  >
    <header class="overlay-header">
      <span class="overlay-title">{i18n.t('bedMesh.screws.title')}</span>
      <button class="icon-btn" onclick={close} title={i18n.t('bedMesh.screws.close')}>
        <Icon name="x" size={14} />
      </button>
    </header>

    <div class="overlay-body">
      {#if store.screws.error}
        <div class="warn-banner">
          <Icon name="warning" size={14} />
          <span>
            {i18n.t('bedMesh.screws.error')}
            {#if store.screws.maxDeviation != null}
              ({i18n.t('bedMesh.screws.maxDeviation')}:
              {store.screws.maxDeviation.toFixed(3)} mm)
            {/if}
          </span>
        </div>
      {/if}

      <table class="screws-table">
        <thead>
          <tr>
            <th>{i18n.t('bedMesh.screws.screw')}</th>
            <th class="col-num">Z, mm</th>
            <th>{i18n.t('bedMesh.screws.adjust')}</th>
          </tr>
        </thead>
        <tbody>
          {#each store.screws.results as s (s.name)}
            <tr class:base={s.isBase}>
              <td>
                <span class="screw-name">{s.name}</span>
                {#if s.isBase}
                  <span class="base-badge">{i18n.t('bedMesh.screws.base')}</span>
                {/if}
              </td>
              <td class="col-num">{s.z != null ? s.z.toFixed(3) : '—'}</td>
              <td class="col-adjust">
                {#if s.isBase}
                  —
                {:else}
                  <span
                    class="sign"
                    class:cw={s.sign === 'CW'}
                    class:ccw={s.sign === 'CCW'}
                  >
                    {s.sign}
                  </span>
                  <span class="adjust">{s.adjust}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <p class="hint">{i18n.t('bedMesh.screws.hint')}</p>
    </div>

    <footer class="overlay-footer">
      <button class="btn" disabled={busy} onclick={recalc}>
        <Icon name="refresh" size={14} />
        {i18n.t('bedMesh.screws.recalculate')}
      </button>
      <button class="btn" onclick={close}>{i18n.t('bedMesh.screws.close')}</button>
    </footer>
  </div>
{/if}

<style>
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    z-index: 1;
  }

  .overlay-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 460px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    z-index: 2;
  }

  .overlay-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .overlay-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .overlay-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    overflow-y: auto;
    min-height: 0;
  }

  .warn-banner {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: var(--font-size-sm);
  }

  .screws-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .screws-table th {
    text-align: start;
    color: var(--text-muted);
    font-weight: 500;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }

  .screws-table td {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .screws-table tbody tr:last-child td {
    border-bottom: none;
  }

  .screws-table tr.base td {
    background: var(--bg-surface-active);
  }

  .screw-name {
    font-family: monospace;
  }

  .base-badge {
    margin-inline-start: var(--space-xs);
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-surface-hover);
    border: 1px solid var(--border-color);
    color: var(--text-muted);
    font-size: var(--font-size-xs, 11px);
  }

  .col-num {
    font-family: monospace;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .col-adjust {
    white-space: nowrap;
  }

  .sign {
    display: inline-block;
    min-width: 34px;
    text-align: center;
    margin-inline-end: var(--space-xs);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs, 11px);
    font-weight: 600;
    color: #fff;
  }

  .sign.cw { background: #d19a66; }
  .sign.ccw { background: #61afef; }

  .adjust {
    font-family: monospace;
  }

  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-size-xs, 11px);
    line-height: 1.5;
  }

  .overlay-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--border-color);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>