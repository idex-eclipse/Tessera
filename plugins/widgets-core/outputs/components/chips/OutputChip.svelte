<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useOutputs } from '../../use-outputs.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import SliderField from '../../../../shared/slider-field/SliderField.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const outputs = useOutputs(api);
  const klippy = useKlippyState(api);

  let objectId = $derived(params.chipId ?? '');
  let editMode = $derived(params.edit === '1');
  let customLabel = $derived(params.chipLabel);

  // Единый источник: хук хранит items и values (module-state)
  let item = $derived(outputs.items.find((it) => it.id === objectId) ?? null);
  let value = $derived(outputs.values[objectId] ?? null);
  let isFan = $derived(item !== null && item.kind !== 'output_pin');
  let readOnly = $derived(item?.readOnly === true);
  let label = $derived(customLabel || item?.label || objectId);

  // Для display: raw для пинов, % для fan
  let displayValue = $derived.by<string>(() => {
    if (value == null || !item) return '—';
    if (item.kind === 'output_pin') {
      return item.decimals === 0
        ? String(Math.round(value))
        : value.toFixed(item.decimals);
    }
    return `${Math.round(value * 100)}%`;
  });

  // Нормализация 0..1 только для визуального бара и подсветки «активно»
  let valueNorm = $derived.by<number>(() => {
    if (value == null || !item) return 0;
    if (item.kind === 'output_pin') {
      const range = item.max - item.min || 1;
      return (value - item.min) / range;
    }
    return value;
  });
  let active = $derived(valueNorm > 0.001);
  let barPct = $derived(Math.round(valueNorm * 100));

  let missing = $derived(klippy.state === 'ready' && item === null);

  let printState = $state<string>('idle');
  $effect(() => {
    return api.moonraker().subscribe(
      { print_stats: ['state'] },
      (delta: any) => {
        const s = delta?.print_stats?.state;
        if (typeof s === 'string') printState = s;
      },
    );
  });
  let disabled = $derived(editMode || missing || item === null);

  // --- поповер ---
  let chipEl = $state<HTMLDivElement | null>(null);
  let popoverOpen = $state(false);
  let placement = $state<{ above: boolean; alignRight: boolean }>({ above: true, alignRight: false });

  function openPopover(): void {
    if (disabled) return;
    const rect = chipEl?.getBoundingClientRect();
    if (rect) {
      placement = { above: rect.top > 180, alignRight: rect.left + 240 > window.innerWidth };
    }
    popoverOpen = true;
  }
  function closePopover(): void { popoverOpen = false; }

  function sendRaw(raw: number): void {
    if (!item) return;
    outputs.setValue(item.id, raw);
  }

  /** Значения слайдера: для pin — raw в диапазоне min..max, для fan — % 0..100. */
  function sliderValue(): number {
    if (!item || value == null) return 0;
    if (item.kind === 'output_pin') return value;
    return value * 100;
  }

  function commitSlider(v: number): void {
    if (!item) return;
    if (item.kind === 'output_pin') {
      sendRaw(v);
    } else {
      sendRaw(Math.min(1, Math.max(0, v / 100)));
    }
  }

  function resetSlider(): void {
    if (!item) return;
    sendRaw(item.kind === 'output_pin' ? item.min : 0);
  }

  const PRESETS_ALL = [0, 25, 50, 75, 100];
  const PRESETS_BINARY = [0, 100];

  /** Бинарный пин (digital): диапазон ≤ 1 и шаг ≥ 1 — проценты между 0 и 100 бессмысленны. */
  let isBinaryPin = $derived(
    item?.kind === 'output_pin' && item.max - item.min <= 1 && item.step >= 1,
  );
  let presets = $derived(isBinaryPin ? PRESETS_BINARY : PRESETS_ALL);

  /** Пресет в raw-значение предмета: для fan min=0/max=1 → pct/100;
   *  для пина — доля его конф-диапазона [min..max], с уважением шага digital-пинов. */
  function presetValue(pct: number): number {
    if (!item) return 0;
    const raw = item.min + (pct / 100) * (item.max - item.min);
    if (item.kind === 'output_pin' && item.step >= 1) return Math.round(raw);
    return raw;
  }

  function sendPreset(pct: number): void {
    sendRaw(presetValue(pct));
    closePopover();   // коммит-действие закрывает поповер, как set-target у temperature
  }

  let currentPct = $derived(Math.round(valueNorm * 100));
  function isPresetActive(pct: number): boolean {
    return Math.abs(currentPct - pct) < 1;
  }
</script>

<div class="chip-root">
  <div
    class="chip"
    class:fan={isFan}
    class:pin={item?.kind === 'output_pin'}
    class:auto={readOnly}
    class:active
    class:missing
    class:interactive={!disabled}
    bind:this={chipEl}
    onclick={openPopover}
    role="button"
    tabindex={disabled ? -1 : 0}
    onkeydown={(e) => { if (e.key === 'Enter' && !disabled) openPopover(); }}
    title={readOnly ? i18n.t('widgets.outputs.autoNote') : undefined}
  >
    {#if klippy.state !== 'ready'}
      <KlippyNotReadyChip />
    {:else}
      <span class="stripe"></span>
      <span class="body">
        <span class="top">
          <span class="label" title={objectId}>{label}</span>
        </span>
        <span class="bottom">
          <span class="kind" class:lit={active}>
            {#if isFan}
              <Icon name="kind-fan" size={40} style={active ? `--spin-d: ${(1.9 - 1.5 * valueNorm).toFixed(2)}s` : ''} />
            {:else if item?.kind === 'output_pin'}
              <Icon name="kind-pin" size={40} />
            {/if}
          </span>
          <span class="state-text">{active ? displayValue : i18n.t('widgets.outputs.stateOff')}</span>
        </span>
      </span>
      {#if item?.kind !== 'output_pin' || (item.max - item.min) > 1}
        <span class="bar"><span class="fill" style:width="{barPct}%"></span></span>
      {/if}
    {/if}
  </div>

  {#if popoverOpen && item}
    <div class="chip-popover-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="chip-popover" class:below={!placement.above} class:align-right={placement.alignRight}>
      <div class="pop-title">{label}</div>

      {#if readOnly}
        <div class="pop-info">
          <div class="pop-row">
            <span>{i18n.t('widgets.outputs.speed')}</span>
            <span class="mono">{displayValue}</span>
          </div>
          <p class="pop-note">{i18n.t('widgets.outputs.autoNote')}</p>
        </div>
      {:else}
        <div class="preset-row" role="group" aria-label={label}>
          {#each presets as pct (pct)}
            <button
              class="preset-btn"
              class:active={isPresetActive(pct)}
              onclick={() => sendPreset(pct)}
            >
              {#if isBinaryPin}
                {pct === 0 ? i18n.t('widgets.outputs.stateOff') : i18n.t('widgets.outputs.stateOn')}
              {:else}
                {pct}%
              {/if}
            </button>
          {/each}
        </div>

        <SliderField
          label={isFan ? i18n.t('widgets.outputs.speed') : i18n.t('widgets.outputs.value')}
          value={sliderValue()}
          min={item.kind === 'output_pin' ? item.min : 0}
          max={item.kind === 'output_pin' ? item.max : 100}
          step={item.kind === 'output_pin' ? item.step : 1}
          unit={isFan ? '%' : ''}
          decimals={item.kind === 'output_pin' ? item.decimals : 0}
          onCommit={commitSlider}
          onReset={resetSlider}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .chip-root {
    position: relative;
    height: 100%;
  }

  .chip {
    position: relative;
    display: flex;
    height: 100%;
    min-width: 104px;
    max-width: 220px;
    padding: 4px 10px 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    overflow: hidden;
    transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
  }
  .chip.fan.active .stripe {
    background: var(--cool);
  }
  .chip.pin.active .stripe {
    background: var(--heat);
  }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2px;
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
    white-space: nowrap;
  }

  .bottom {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .state-text {
    margin-left: auto;
    flex-shrink: 0;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-lg);
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  .chip.fan.active .state-text { color: var(--text-primary); }
  .chip.pin.active .state-text { color: var(--text-primary); }

  .kind {
    display: flex;
    line-height: 0;
    color: var(--text-muted);
    opacity: 0.55;
    flex-shrink: 0;
  }

  .kind.lit { opacity: 1; }

  .chip.fan .kind.lit { color: var(--cool); }
  .chip.pin .kind.lit { color: var(--heat); }

  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: transparent;
    z-index: 100;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--cool);
    transition: width var(--transition-normal);
  }

  .chip.pin .fill { background: transparent; }
  .body { z-index: 100; }

  .chip.fan.active {
    background: color-mix(in srgb, var(--heat) 9%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--heat) 32%, var(--border-color));
  }
  .chip.pin.active {
    background: color-mix(in srgb, var(--heat) 9%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--heat) 32%, var(--border-color));
  }
  .chip.interactive { cursor: pointer; }

  .chip.interactive:hover {
    box-shadow: var(--shadow-sm);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  }

  .chip.interactive:active { transform: translateY(1px); }

  .chip.missing { border-style: dashed; }

  .chip.missing .label, .chip.missing .state-text { color: var(--text-muted); }

  .chip-popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .chip-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 1001;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: var(--space-sm);
    min-width: 220px;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .chip-popover.below {
    bottom: auto;
    top: calc(100% + 6px);
  }

  .chip-popover.align-right {
    left: auto;
    right: 0;
  }

  .pop-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    padding: 0 var(--space-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-row {
    display: flex;
    gap: var(--space-xs);
  }

  .preset-btn {
    flex: 1;
    padding: var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover-no-override);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }
  .preset-btn:hover { background: var(--bg-surface-active); }
  
  .preset-btn.active {
    background: var(--accent-subtle-strong);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
</style>