<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useTemperatureData } from '../../use-temperature.svelte';
  import { isRtl, shouldAlignToEnd } from '../../../../shared/popover-align';
  import TempKindIcon from '../TempKindIcon.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../../shared/klippy-state/KlippyNotReady.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const temp = useTemperatureData(api);
  const klippy = useKlippyState(api);

  let sensorId = $derived(params.chipId ?? '');
  let editMode = $derived(params.edit === '1');
  let customLabel = $derived(params.chipLabel);

  let sensor = $derived(temp.sensors.find((s) => s.name === sensorId));
  let label = $derived(customLabel || sensor?.displayName || sensorId);
  let kind = $derived(sensor?.kind ?? 'sensor');
  let controlled = $derived(kind !== 'sensor');
  let temperature = $derived(sensor?.temperature);
  let target = $derived(sensor?.target);
  let minTemp = $derived(sensor?.minTemp ?? null);
  let maxTemp = $derived(sensor?.maxTemp ?? null);

  let fanSpeed = $derived(kind === 'fan' ? (sensor?.speed ?? sensor?.power ?? 0) : 0);

  let targetActive = $derived(controlled && (target ?? 0) > 0);
  let powerPct = $derived.by<number | null>(() => {
    if (!sensor || !controlled) return null;
    const p = sensor.kind === 'fan' ? (sensor.speed ?? sensor.power) : sensor.power;
    return p == null ? null : Math.min(100, Math.max(0, Math.round(p * 100)));
  });
  let missing = $derived(temp.klippyState === 'ready' && !sensor);
  let kindLit = $derived(kind === 'fan' ? fanSpeed > 0 : targetActive);

  // popover
  let chipEl = $state<HTMLDivElement | null>(null);
  let popoverOpen = $state(false);
  let placement = $state<{ above: boolean; alignRight: boolean }>({ above: true, alignRight: false });
  let inputEl = $state<HTMLInputElement | null>(null);

  function openPopover(): void {
    if (editMode || !sensor || !controlled || missing) return;
    const rect = chipEl?.getBoundingClientRect();
    if (rect) {
      // поповер выравнивается по начальному краю чипа (в RTL — по правому)
      placement = {
        above: rect.top > 180,
        alignRight: shouldAlignToEnd(rect, 220, window.innerWidth, isRtl()),
      };
    }
    popoverOpen = true;
  }
  function closePopover(): void { popoverOpen = false; }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') closePopover();
  }

  $effect(() => {
    if (!popoverOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function handleSetTarget(e: Event): Promise<void> {
    e.preventDefault();
    if (!inputEl || !sensor) return;
    const value = parseFloat(inputEl.value);
    if (!Number.isFinite(value) || value < 0) return;
    await temp.setTarget(sensor.name, value);
    closePopover();
  }
</script>

<div class="chip-root">
  <div
    class="chip"
    class:controlled
    class:active={targetActive || (kind === 'fan' && (sensor?.speed ?? 0) > 0)}
    class:fan={kind === 'fan'}
    class:missing
    class:interactive={!editMode && controlled && !missing}
    bind:this={chipEl}
    onclick={openPopover}
    role={controlled ? 'button' : undefined}
    tabindex={controlled && !editMode && !missing ? 0 : undefined}
    onkeydown={(e) => { if (e.key === 'Enter' && controlled) openPopover(); }}
  >
  {#if klippy.state != 'ready'}
    <KlippyNotReadyChip/>
  {:else}
    <span class="stripe" style:background={sensor?.color ?? 'var(--border-color)'}></span>
    <span class="body">
      <span class="top">
        <span class="label">{label}</span>
        {#if targetActive}
          <span class="target">→{Math.round(target ?? 0)}°</span>
        {/if}
      </span>
      <span class="bottom">
        <span class="kind" class:lit={kindLit}>
          <TempKindIcon {kind} size={40} speed={kind === 'fan' ? fanSpeed : null} />
        </span>
        {#if temperature != null}
          <span class="value">{temperature.toFixed(1)}<span class="unit">°C</span></span>
        {:else}
          <span class="value muted">—</span>
        {/if}
      </span>
    </span>

    {#if powerPct != null}
      <span class="bar" title="{powerPct}%"><span class="fill" style:width="{powerPct}%"></span></span>
    {/if}
 {/if}
  </div>

  {#if popoverOpen && sensor}
    <div class="chip-popover-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="chip-popover" class:below={!placement.above} class:align-right={placement.alignRight}>
      <form onsubmit={handleSetTarget}>
        <label>
          <span>
            {i18n.t('widgets.temperature.target')}
            {#if maxTemp != null}
              <span class="pop-hint">/ max {maxTemp}</span>
            {/if}
          </span>
          <input bind:this={inputEl} type="number" step="1" min="{minTemp ?? undefined}" max="{maxTemp ?? undefined}" value={sensor.target ?? 0} autofocus />
        </label>
        <div class="popover-actions">
          <button type="button" onclick={closePopover}>{i18n.t('common.cancel')}</button>
          <button type="submit">{i18n.t('common.save')}</button>
        </div>
      </form>
    </div>
  {/if}
</div>

<style>
  .chip-root { position: relative; height: 100%; }

  .chip {
    position: relative;
    display: flex;
    height: 100%;
    min-width: 96px;
    max-width: 220px;
    padding: 3px 8px 4px 10px;
    padding-inline: 10px 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    overflow: hidden;
    transition:
        background var(--transition-fast),
        border-color var(--transition-fast),
        box-shadow var(--transition-fast);
  }

  .stripe {
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    bottom: 0;
    width: 3px;
  }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-weight: 600;
  }

  .label {
    font-size: var(--font-size-lg);
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .target {
    margin-inline-start: auto;
    direction: ltr;
    flex-shrink: 0;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--heat);
    background: color-mix(in srgb, var(--heat) 14%, transparent);
    padding: 0 4px; border-radius: 4px;
  }
  .fan .target {
    color: var(--cool);
    background: color-mix(in srgb, var(--cool) 14%, transparent);
  }

  .bottom {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .value {
    margin-inline-start: auto;
    direction: ltr;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .unit {
    font-size: var(--font-size-lg);
    font-weight: 500;
    color: var(--text-muted);
    margin-inline-start: 2px;
  }

  .value.muted {
    color: var(--text-muted);
    font-weight: 500;
  }

  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: color-mix(in srgb, var(--text-muted) 18%, transparent);
  }

  .fill { display: block; height: 100%; background: var(--heat); transition: width var(--transition-normal); }
  .fan .fill { background: var(--cool); }

  .chip.controlled.active {
    background: color-mix(in srgb, var(--heat) 10%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--heat) 35%, var(--border-color));
  }

  .chip.fan.active {
    background: color-mix(in srgb, var(--heat) 9%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--cool) 32%, var(--border-color));
  }

  .chip.interactive { cursor: pointer; }

  .chip.interactive:hover { 
    box-shadow: var(--shadow-sm); 
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color)); 
  }

  .chip.interactive:active { transform: translateY(1px); }

  .chip.missing { border-style: dashed; }

  .chip.missing .label, .chip.missing .value { color: var(--text-muted); }

  .chip-popover-backdrop { position: fixed; inset: 0; z-index: 1000; }

  .chip-popover {
    position: absolute; 
    bottom: calc(100% + 6px);
    inset-inline-start: 0; z-index: 1001;
    background: var(--bg-surface); 
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md); 
    box-shadow: var(--shadow-md);
    padding: var(--space-sm); 
    min-width: 180px;
  }

  .chip-popover.below { bottom: auto; top: calc(100% + 6px); }

  .chip-popover.align-right { inset-inline-start: auto; inset-inline-end: 0; }

  .chip-popover label {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: var(--font-size-md);
    color: var(--text-secondary);
  }

  .chip-popover input {
    padding: var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-md);
  }

  .popover-actions { 
    display: flex; 
    gap: var(--space-xs); 
    margin-top: var(--space-sm); 
  }

  .popover-actions button { 
    flex: 1; 
    padding: var(--space-xs) var(--space-sm); 
    border: 1px solid var(--border-color); 
    border-radius: var(--radius-sm); 
    background: var(--bg-surface-hover); 
    color: var(--text-primary); 
    font-size: var(--font-size-sm); 
    cursor: pointer; 
  }

  .popover-actions button[type='submit'] { 
    background: var(--accent); 
    border-color: var(--accent); 
    color: var(--accent-text); 
  }
  
  .pop-hint { color: var(--text-muted); font-size: 11px; margin-inline-start: 4px; }

  .kind {
    display: flex;
    line-height: 0;
    color: var(--text-muted);
    opacity: 0.55;
    flex-shrink: 0;
  }
  .kind.lit { opacity: 1; }
  .chip.controlled .kind.lit { color: var(--heat); }
  .chip.fan .kind.lit { color: var(--cool); }

  .body { z-index: 100; }
  .bar { z-index: 100; }
</style>