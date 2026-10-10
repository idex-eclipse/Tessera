<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import { livez, resetLivezState } from '../../../live-z-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);

  const STEPS = [0.05, 0.025, 0.01, 0.005];
  let step = $state(0.01);
  let busy = $state('');
  let saveOpen = $state(false);
  let pendingSave = $derived(
    livez.staged !== null &&
      livez.baseline !== null &&
      Math.abs(livez.staged - livez.baseline) > 1e-4,
  );

  $effect(() => {
    if (store.state.loaded && livez.baseline === null && refOffset != null) {
      livez.baseline = refOffset;
    }
  });

  // Конфигурированный офсет — ТА ЖЕ цепочка источников, что в секции
  // Probe & Z Offset (offsetRefs): probe → bltouch → endstop, первый не-null.
  let refOffset = $derived.by(() => {
    const z = store.state.zOffsets;
    return z.probe ?? z.bltouch ?? z.endstop;
  });

  // живая подстройка: gcode_move.homing_origin[2]
  let delta = $derived(store.state.zOffsetLive ?? 0);
  let zHomed = $derived(store.state.homedAxes.includes('z'));
  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );

  function fmtSigned(v: number): string {
    return `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(3)}`;
  }

  async function exec(key: string, script: string): Promise<boolean> {
    if (busy !== '') return false;
    busy = key;
    try {
      await runGcode(api.moonraker(), script);
      return true;
    } catch (e) {
      // ошибки и guard-deny несёт центр уведомлений
      console.error('[calibrations] livez failed:', script, e);
      return false;
    } finally {
      busy = '';
    }
  }

  function adjust(dir: 1 | -1): void {
    void exec(`adj${dir}`, gcode.setZAdjust(dir * step, zHomed));
    pendingSave = false;
  }

  async function saveOffset(): Promise<void> {
    const d = delta;
    if (await exec('apply', gcode.zOffsetApplyProbe())) {
      livez.staged = (livez.staged ?? livez.baseline ?? (refOffset ?? 0)) + d;
    }
    pendingSave = true;
  }

  function confirmSaveConfig(): void {
    saveOpen = false;
    void exec('save', gcode.saveConfig()).then((ok) => {
      if (ok) resetLivezState();   // рестарт перечитает baseline по klippy_ready
    });
  }
</script>

<div class="livez">
  <!-- слева: строки значений, значение рядом с именем -->
  <div class="rows">
    <div class="vrow">
      <span class="vlabel">{i18n.t('calibrations.liveZ.probeOffset')}</span>
      <span class="vvalue mono">{refOffset === null ? '—' : refOffset.toFixed(3)}</span>
    </div>
    <div class="vrow">
      <span class="vlabel">{i18n.t('calibrations.liveZ.offsetDelta')}</span>
      <span class="vvalue mono" class:active={delta !== 0}>{fmtSigned(delta)}</span>
    </div>
    {#if !zHomed}
      <p class="hint">{i18n.t('calibrations.liveZ.notHomed')}</p>
    {/if}
  </div>

  <!-- справа: кластер (шаги + шевроны справа от них), save-кнопки под кластером -->
  <div class="controls">
    <div class="cluster">
      <div class="steps">
        {#each STEPS as s (s)}
          <button class="cell" class:active={step === s} onclick={() => (step = s)}>{s}</button>
        {/each}
      </div>
      <div class="ud">
        <button class="cell chev" disabled={busy !== ''} onclick={() => adjust(1)} title="+{step} mm">
          <Icon name="chevron-up" size={16} />
        </button>
        <button class="cell chev" disabled={busy !== ''} onclick={() => adjust(-1)} title="−{step} mm">
          <Icon name="chevron-down" size={16} />
        </button>
      </div>
    </div>

    <div class="saves">
      <button
        class="btn"
        disabled={busy !== ''}
        onclick={saveOffset}
        title={i18n.t('calibrations.liveZ.saveOffsetHint')}
      >
        {i18n.t('calibrations.liveZ.saveOffset')}
      </button>
      {#if pendingSave}
        <button class="btn primary" disabled={busy !== '' || isPrinting} onclick={() => (saveOpen = true)}>
          {i18n.t('calibrations.saveConfig')}
        </button>
      {/if}
    </div>
  </div>
</div>

{#if saveOpen}
  <ConfirmDialog
    open={saveOpen}
    title={i18n.t('calibrations.liveZ.saveConfirmTitle')}
    message={i18n.t('calibrations.liveZ.saveConfirmText')}
    confirmLabel={i18n.t('calibrations.liveZ.saveConfig')}
    danger={true}
    onConfirm={confirmSaveConfig}
    onClose={() => (saveOpen = false)}
  />
{/if}

<style>
  .livez {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-md);
    align-items: start;
  }

  .rows { display: flex; flex-direction: column; gap: var(--space-xs); min-width: 0; }
  /* значение СРАЗУ за именем, не прижато к правому краю */
  .vrow { display: flex; align-items: baseline; gap: var(--space-sm); }
  .vlabel { color: var(--text-secondary); font-size: var(--font-size-sm); white-space: nowrap; }
  .vvalue { font-size: var(--font-size-md); font-weight: 600; color: var(--text-primary); }
  .vvalue.active { color: var(--accent); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .hint { margin: 0; color: var(--warning); font-size: var(--font-size-sm); }

  .controls { display: flex; flex-direction: column; gap: var(--space-xs); }
  /* матрица: шаги 2×2 слева, шевроны колонкой справа от шагов */
  .cluster {
    display: grid;
    grid-template-columns: auto auto;
    gap: var(--space-xs);
    align-items: stretch;
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(2, minmax(56px, auto));
    gap: var(--space-xs);
  }
  .ud { display: flex; flex-direction: column; gap: var(--space-xs); }
  .cell {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: monospace;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .cell:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .cell:disabled { opacity: 0.5; cursor: not-allowed; }
  .cell.active { background: var(--bg-surface-active); color: var(--accent); border-color: var(--accent); }
  .chev { display: flex; align-items: center; justify-content: center; flex: 1; }

  /* save-кнопки под кластером, шириной с кластер */
  .saves { display: flex; flex-direction: column; gap: var(--space-xs); }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--font-size-sm);
    cursor: pointer;
    width: 100%;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

  @media (max-width: 480px) {
    .livez { grid-template-columns: 1fr; }
  }
</style>