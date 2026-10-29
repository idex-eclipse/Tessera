<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { useBedMesh } from '../../use-bed-mesh.svelte.ts';
  import { gcode, runGcode } from '../../commands.ts';
  import { ensurePrinterTracker } from '../../printer-tracker.ts';

  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useBedMesh(api);
  const klippy = useKlippyState(api);

  // Оверлей смонтирован всегда (постоянная поверхность), поэтому именно он запускает
  // трекер состояния всех принтеров для гардов и hotkeys плагина (идемпотентно).
  ensurePrinterTracker(api);

  let busy = $state('');

  // видимость — решение плагина по состоянию (M): manual_probe.is_active (per-printer внутри ядра)
  let open = $derived(store.probe.isActive && klippy.ready);

  // шаги зондирования: крупные сверху, точные снизу
  const STEP_VALUES = ['1', '0.1', '0.05', '0.025', '0.01', '0.005'];

  async function exec(action: string, script: string): Promise<void> {
    if (busy) return;
    busy = action;
    try {
      await runGcode(api.moonraker(), script);
      await store.refresh();
    } catch (e) {
      console.error('[bed-mesh] manual probe command failed:', script, e);
    } finally {
      busy = '';
    }
  }

  function fmt(v: number | null): string {
    return v != null ? v.toFixed(3) : '—';
  }
</script>

{#if open}
  <div class="overlay-backdrop" role="presentation"></div>

  <div
    class="overlay-panel"
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t('bedMesh.testZ.title')}
  >
    <header class="overlay-header">
      <span class="overlay-title">{i18n.t('bedMesh.testZ.title')}</span>
    </header>

    <div class="overlay-body">
      <div class="z-display">
        <span class="z-value">{fmt(store.probe.zPosition)}</span>
        <span class="z-unit">mm</span>
      </div>

      <div class="z-bounds">
        <span class="bound">
          {i18n.t('bedMesh.testZ.lower')}: {fmt(store.probe.zLower)}
        </span>
        <span class="bound">
          {i18n.t('bedMesh.testZ.upper')}: {fmt(store.probe.zUpper)}
        </span>
      </div>

      <div class="steps">
        {#each STEP_VALUES as v (v)}
          <button
            class="step up"
            disabled={busy !== ''}
            onclick={() => exec(`testz:+${v}`, gcode.testz(`+${v}`))}
          >
            +{v}
          </button>
        {/each}
      </div>

      <div class="steps">
        {#each STEP_VALUES as v (v)}
          <button
            class="step down"
            disabled={busy !== ''}
            onclick={() => exec(`testz:-${v}`, gcode.testz(`-${v}`))}
          >
            -{v}
          </button>
        {/each}
      </div>

      <p class="hint">{i18n.t('bedMesh.testZ.hint')}</p>
    </div>

    <footer class="overlay-footer">
      <button
        class="btn danger"
        disabled={busy !== ''}
        onclick={() => exec('abort', gcode.abort)}
      >
        {i18n.t('bedMesh.testZ.abort')}
      </button>
      <button
        class="btn primary"
        disabled={busy !== ''}
        onclick={() => exec('accept', gcode.accept)}
      >
        {i18n.t('bedMesh.testZ.accept')}
      </button>
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
    max-width: 420px;
    max-height: 90vh;
    max-height: 90dvh;
    overflow-y: auto;
    container-type: inline-size;
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

  .overlay-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
  }

  .z-display {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-xs);
  }

  .z-value {
    font-family: monospace;
    font-size: 32px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .z-unit {
    color: var(--text-muted);
    font-size: var(--font-size-md);
  }

  .z-bounds {
    display: flex;
    justify-content: center;
    gap: var(--space-md);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-family: monospace;
  }

  .steps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-xs);
  }

  .step {
    padding: var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-md);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .step:hover:not(:disabled) {
    background: var(--bg-surface-active);
    border-color: var(--accent);
  }

  .step:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    line-height: 1.5;
    text-align: center;
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
    padding: var(--space-xs) var(--space-lg);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    font-weight: 500;
    cursor: pointer;
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.primary {
    background: var(--accent);
    color: var(--accent-text);
  }

  .btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn.danger {
    background: var(--danger);
    color: var(--accent-text);
  }

  .btn.danger:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  /* узкий контейнер (сам диалог): кнопки не ниже 44px */
  @container (max-width: 520px) {
    .step, .btn { min-height: 44px; }
  }
</style>
