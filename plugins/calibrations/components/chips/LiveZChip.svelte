<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../use-calibrations.svelte';
  import { gcode, runGcode } from '../../commands.ts';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../shared/klippy-state/KlippyNotReady.svelte';
  import ConfirmDialog from '../../../shared/confirm-dialog.svelte';
  import Icon from '../../../shared/icons/Icon.svelte';
  import { isRtl, shouldAlignToEnd } from '../../../shared/popover-align.ts';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);
  const klippy = useKlippyState(api);

  let editMode = $derived(params.edit === '1');

  const STEPS = [0.05, 0.025, 0.01, 0.005];
  let step = $state(0.01);
  let busy = $state('');
  let saveOpen = $state(false);

  let refOffset = $derived.by(() => {
    const z = store.state.zOffsets;
    return z.probe ?? z.bltouch ?? z.endstop;
  });

  let delta = $derived(store.state.zOffsetLive ?? 0);
  let zHomed = $derived(store.state.homedAxes.includes('z'));
  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );

  $effect(() => {
    if (store.state.loaded && store.livezState.baseline === null && refOffset != null) {
      store.setLivezBaselineFromRef(refOffset);
    }
  });

  let pendingSave = $derived(store.livezState.hasUnsavedApply);

  let missing = $derived(klippy.state === 'ready' && refOffset == null);
  let disabled = $derived(editMode);

  const POPOVER_WIDTH = 240;
  let chipEl = $state<HTMLDivElement | null>(null);
  let popoverOpen = $state(false);
  let placement = $state<{ above: boolean; alignRight: boolean }>({ above: true, alignRight: false });

  function openPopover(): void {
    if (disabled) return;
    const rect = chipEl?.getBoundingClientRect();
    if (rect) {
      // Поповер растёт от начала строки: вправо в LTR, влево в RTL — проверяем нужный край.
      placement = {
        above: rect.top > 260,
        alignRight: shouldAlignToEnd(rect, POPOVER_WIDTH, window.innerWidth, isRtl()),
      };
    }
    popoverOpen = true;
  }
  function closePopover(): void { popoverOpen = false; }

  function fmtSigned(v: number): string {
    return `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(3)}`;
  }

  async function execSave(key: string, script: string): Promise<boolean> {
    if (busy !== '') return false;
    busy = key;
    try {
      await runGcode(api.moonraker(), script);
      return true;
    } catch (e) {
      console.error('[livez-chip] failed:', script, e);
      return false;
    } finally {
      busy = '';
    }
  }

  // adjust сбрасывает hasUnsavedApply (новый adjust делает предыдущий apply устаревшим)
  function adjust(dir: 1 | -1): void {
    store.resetLivezApply();
    void runGcode(api.moonraker(), gcode.setZAdjust(dir * step, zHomed));
  }

  async function saveOffset(): Promise<void> {
    const d = delta;
    if (await execSave('apply', gcode.zOffsetApplyProbe())) {
      store.applyLivezOffset(d);
    }
  }

  function confirmSaveConfig(): void {
    saveOpen = false;
    void execSave('save', gcode.saveConfig()).then((ok) => {
      if (ok) {
        store.resetLivezState();
      }
    });
  }
</script>

<div class="chip-root">
  <div
    class="chip"
    class:interactive={!disabled}
    bind:this={chipEl}
    onclick={openPopover}
    role="button"
    tabindex={disabled ? -1 : 0}
    onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); openPopover(); } }}
  >
    {#if klippy.state !== 'ready'}
      <KlippyNotReadyChip />
    {:else}
      <span class="stripe"></span>
      <span class="body">
        <span class="top">
          <span class="label">{i18n.t('calibrations.liveZ.chipSection')}</span>
          {#if refOffset != null}<span class="badge">{refOffset.toFixed(3)}</span>{/if}
        </span>
        <span class="bottom">
          <span class="kind" class:active={popoverOpen}><Icon name="kind-tuning" size={40} /></span>
          <span class="value">{fmtSigned(delta)}</span>
        </span>
      </span>
    {/if}
  </div>

  {#if popoverOpen && !missing}
    <div class="chip-popover-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="chip-popover" class:below={!placement.above} class:align-right={placement.alignRight}>
      <div class="cluster">
        <div class="steps">
          {#each STEPS as s (s)}
            <button class="cell" class:active={step === s} onclick={() => (step = s)}>{s}</button>
          {/each}
        </div>
        <div class="ud">
          <button class="cell chev" onclick={() => adjust(1)} title="+{step} mm">
            <Icon name="chevron-up" size={16} />
          </button>
          <button class="cell chev" onclick={() => adjust(-1)} title="−{step} mm">
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
          <button
            class="btn primary"
            disabled={busy !== '' || isPrinting}
            onclick={() => (saveOpen = true)}
          >
            {i18n.t('calibrations.saveConfig')}
          </button>
        {/if}
      </div>
    </div>
  {/if}
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
  .chip-root { position: relative; height: 100%; }
  .chip {
    position: relative; display: flex; height: 100%;
    min-width: 104px; max-width: 220px;
    padding-block: 4px 6px; padding-inline: 12px 10px;
    border: 1px solid var(--border-color); border-radius: var(--radius-md);
    background: var(--bg-surface); overflow: hidden;
    transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  .stripe { position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 3px; background: var(--accent); }

  .body { display: flex; flex-direction: column; justify-content: space-between; gap: 2px; min-width: 0; flex: 1; }
  .top { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 600; }
  .label { font-size: var(--font-size-lg); color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .badge { font-family: ui-monospace, monospace; font-size: var(--font-size-sm); color: var(--text-muted); flex-shrink: 0; }

  .bottom { display: flex; align-items: center; gap: 6px; }
  .kind { display: flex; line-height: 0; color: var(--text-muted); opacity: 0.55; flex-shrink: 0; }
  .kind.active { color: var(--accent); }
  .value {
    margin-inline-start: auto; flex-shrink: 0;
    font-family: ui-monospace, monospace; font-size: var(--font-size-lg); font-weight: 700;
    color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1;
  }

  .chip.interactive { cursor: pointer; }
  .chip.interactive:hover { box-shadow: var(--shadow-sm); border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color)); }
  .chip.interactive:active { transform: translateY(1px); }

  .chip-popover-backdrop { position: fixed; inset: 0; z-index: 1000; }
  .chip-popover {
    position: absolute; bottom: calc(100% + 6px); inset-inline-start: 0; z-index: 1001;
    background: var(--bg-surface); border: 1px solid var(--border-color);
    border-radius: var(--radius-md); box-shadow: var(--shadow-md);
    padding: var(--space-sm);
    display: flex; flex-direction: column; gap: var(--space-xs);
  }
  .chip-popover.below { bottom: auto; top: calc(100% + 6px); }
  /* alignRight = «прижать к концу строки»: в RTL это левый край */
  .chip-popover.align-right { inset-inline-start: auto; inset-inline-end: 0; }

  .cluster { display: grid; grid-template-columns: auto auto; gap: var(--space-xs); align-items: stretch; }
  .steps { display: grid; grid-template-columns: repeat(2, minmax(56px, auto)); gap: var(--space-xs); }
  .ud { display: flex; flex-direction: column; gap: var(--space-xs); }
  .cell {
    padding: var(--space-xs);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: transparent; color: var(--text-secondary);
    font-family: monospace; font-size: var(--font-size-sm); cursor: pointer;
    transition: background var(--transition-fast);
  }
  .cell:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .cell:disabled { opacity: 0.5; cursor: not-allowed; }
  .cell.active { background: var(--bg-surface-active); color: var(--accent); border-color: var(--accent); }
  .chev { display: flex; align-items: center; justify-content: center; flex: 1; }

  .saves { display: flex; flex-direction: column; gap: var(--space-xs); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: var(--bg-surface-hover); color: var(--text-primary);
    font-size: var(--font-size-sm); cursor: pointer; width: 100%;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 600; }
</style>