<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useFilament } from '../../use-filament.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import { isRtl, shouldAlignToEnd, shouldOpenAbove } from '../../../../shared/popover-align';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const filament = useFilament(api);
  const klippy = useKlippyState(api);

  let sensorId = $derived(params.chipId ?? '');
  let editMode = $derived(params.edit === '1');
  let customLabel = $derived(params.chipLabel);

  let sensor = $derived(filament.sensors.find((s) => s.id === sensorId) ?? null);
  let sensorState = $derived(filament.states[sensorId] ?? null);
  let label = $derived(customLabel || sensor?.name || sensorId);

  let missing = $derived(klippy.state === 'ready' && sensor === null);
  let disabled = $derived(editMode || missing);

  //state
  let statusText = $derived.by(() => {
    if (!sensorState) return '—';
    if (!sensorState.enabled) return i18n.t('widgets.filament.off');
    if (sensorState.detected) return i18n.t('widgets.filament.detected');
    return i18n.t('widgets.filament.empty');
  });

  let statusClass = $derived.by(() => {
    if (!sensorState || !sensorState.enabled) return 'muted';
    return sensorState.detected ? 'ok' : 'error';
  });

  // feature-detect
  let hasResetCommand = $state(false);
  $effect(() => {
    if (sensor?.kind !== 'hall') return;
    let alive = true;
    api
      .moonraker()
      .request<any>('printer.gcode.help')
      .then((help) => {
        if (!alive) return;
        const cmds = Object.keys(help ?? {}).map((c) => c.toUpperCase());
        hasResetCommand = cmds.includes('RESET_FILAMENT_WIDTH_SENSOR');
      })
      .catch(() => {});
    return () => { alive = false; };
  });

  let chipEl = $state<HTMLDivElement | null>(null);
  let popoverOpen = $state(false);
  let placement = $state<{ above: boolean; alignRight: boolean }>({ above: false, alignRight: false });

  function openPopover(): void {
    if (disabled) return;
    const rect = chipEl?.getBoundingClientRect();
    if (rect) {
      placement = { above: shouldOpenAbove(rect, 220, window.innerHeight), alignRight: shouldAlignToEnd(rect, 240, window.innerWidth, isRtl()) };
    }
    popoverOpen = true;
  }
  function closePopover(): void { popoverOpen = false; }

  $effect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') popoverOpen = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function toggleEnabled(): void {
    if (!sensor || !sensorState) return;
    filament.setEnabled(sensor, !sensorState.enabled);
  }

  function resetWidth(): void {
    filament.resetWidth();
  }
</script>

<div class="chip-root">
  <div
    class="chip"
    class:missing
    class:disabled
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
      <span class="stripe" class:ok={statusClass === 'ok'} class:error={statusClass === 'error'} class:muted={statusClass === 'muted'}></span>
      <span class="body">
        <span class="top">
          <span class="category">{i18n.t('widgets.filament.chipSection')}</span>
        </span>
        <span class="bottom">
          <span class="kind"><Icon name="kind-filament" size={40} /></span>
          <span class="info">
            <span class="name" title={label}>{label}</span>
            <span class="status" class:ok={statusClass === 'ok'} class:error={statusClass === 'error'} class:muted={statusClass === 'muted'}>
              {statusText}
            </span>
          </span>
        </span>
      </span>
    {/if}
  </div>

  {#if popoverOpen && sensor && sensorState}
    <div class="chip-popover-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="chip-popover" class:below={!placement.above} class:align-right={placement.alignRight}>
      <div class="pop-title">{label}</div>

      <button class="pop-btn" onclick={toggleEnabled}>
        {sensorState.enabled ? i18n.t('widgets.filament.off') : i18n.t('widgets.filament.enable')}
      </button>

      {#if sensor.kind === 'hall' && sensorState.diameter !== null}
        <div class="pop-info">
          <span class="pop-label">{i18n.t('widgets.filament.diameter')}</span>
          <span class="pop-value">{sensorState.diameter.toFixed(2)} mm</span>
        </div>
      {/if}

      {#if sensor.kind === 'hall' && hasResetCommand}
        <button class="pop-btn" onclick={resetWidth}>
          {i18n.t('widgets.filament.reset')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chip-root { position: relative; height: 100%; }

  .chip {
    position: relative;
    display: flex;
    align-items: stretch;
    height: 100%;
    min-width: 104px;
    max-width: 240px;
    padding-block: 4px 6px;
    padding-inline: 12px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    overflow: hidden;
    transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .stripe {
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--border-color);
  }
  .stripe.ok { background: var(--success); }
  .stripe.error { background: var(--danger); }
  .stripe.muted { background: var(--text-muted); }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .top { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 600; }
  .category {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .bottom { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .kind { display: flex; line-height: 0; color: var(--text-muted); opacity: 0.55; flex-shrink: 0; }

  .info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .status.ok { color: var(--success); }
  .status.error { color: var(--danger); }

  .chip.interactive { cursor: pointer; }
  .chip.interactive:hover {
    box-shadow: var(--shadow-sm);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  }
  .chip.interactive:active { transform: translateY(1px); }
  .chip.missing { border-style: dashed; }
  .chip.missing .name { color: var(--text-muted); }
  .chip.disabled { opacity: 0.5; cursor: not-allowed; }

  .chip-popover-backdrop { position: fixed; inset: 0; z-index: 1000; }
  .chip-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    inset-inline-start: 0;
    z-index: 1001;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: var(--space-sm);
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .chip-popover.below { bottom: auto; top: calc(100% + 6px); }
  .chip-popover.align-right { inset-inline-start: auto; inset-inline-end: 0; }

  .pop-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    padding: 0 var(--space-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pop-btn {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    text-align: start;
  }
  .pop-btn:hover { background: var(--bg-surface-active); }

  .pop-info {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-sm);
    padding: 0 var(--space-xs);
  }
  .pop-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .pop-value {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
</style>