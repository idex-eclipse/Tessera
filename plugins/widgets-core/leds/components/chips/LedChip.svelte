<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useLeds } from '../../use-leds.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import { placeChipPopover } from '../../../../shared/popover-align';
  import { colorToCss, isLit, OFF, rgbwToHex, type Rgbw } from '../../led-data';
  import LedStrip from '../LedStrip.svelte';
  import LedControls from '../LedControls.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const leds = useLeds(api);
  const klippy = useKlippyState(api);

  let objectId = $derived(params.chipId ?? '');
  let editMode = $derived(params.edit === '1');
  let customLabel = $derived(params.chipLabel);

  let item = $derived(leds.items.find((it) => it.id === objectId) ?? null);
  let label = $derived(customLabel || item?.label || objectId);
  let pixels = $derived<Rgbw[]>(
    leds.colors[objectId] ?? Array.from({ length: item?.count ?? 1 }, () => OFF),
  );
  let litPixels = $derived(pixels.filter(isLit));
  let active = $derived(litPixels.length > 0);
  let assigned = $derived(leds.assignedTemplate(objectId));

  /** Цвет полосы чипа: первый горящий пиксель. */
  let accent = $derived(active ? colorToCss(litPixels[0]!) : '');

  let stateText = $derived.by<string>(() => {
    if (!active) return i18n.t('widgets.leds.stateOff');
    if (assigned) return assigned;
    if (pixels.length > 1) return `${litPixels.length}/${pixels.length}`;
    return rgbwToHex(pixels[0]!).toUpperCase();
  });

  let missing = $derived(klippy.state === 'ready' && item === null);
  let disabled = $derived(editMode || missing || item === null);

  // --- поповер ---
  let chipEl = $state<HTMLDivElement | null>(null);
  let popoverOpen = $state(false);
  let popoverStyle = $state('');
  let selected = $state<number[]>([]);

  function openPopover(): void {
    if (disabled) return;
    const rect = chipEl?.getBoundingClientRect();
    if (rect) popoverStyle = placeChipPopover(rect, { width: 280, height: 320 });
    popoverOpen = true;
  }
  function closePopover(): void { popoverOpen = false; }

  $effect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') popoverOpen = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="chip-root">
  <div
    class="chip"
    class:active
    class:missing
    class:interactive={!disabled}
    style:--led={accent || undefined}
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
          <span class="label" title={objectId}>{label}</span>
        </span>
        <span class="bottom">
          <span class="kind" class:lit={active}>
            <Icon name="kind-led" size={40} />
          </span>
          <span class="state-text" title={assigned ?? undefined}>{stateText}</span>
        </span>
      </span>
      {#if pixels.length > 1}
        <span class="bar">
          {#each pixels as px, i (i)}
            <span class="seg" style:background={isLit(px) ? colorToCss(px) : 'transparent'}></span>
          {/each}
        </span>
      {/if}
    {/if}
  </div>

  {#if popoverOpen && item}
    <div class="chip-popover-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="chip-popover" style={popoverStyle}>
      <div class="pop-head">
        <span class="pop-title">{label}</span>
        <button
          class="power"
          class:on={active}
          title={active ? i18n.t('widgets.leds.turnOff') : i18n.t('widgets.leds.turnOn')}
          onclick={() => leds.toggle(item!.id)}
        >
          <Icon name="kind-power" size={14} />
        </button>
      </div>
      {#if pixels.length > 1}
        <LedStrip
          {pixels}
          {selected}
          allLabel={i18n.t('widgets.leds.allPixels')}
          onSelect={(next) => (selected = next)}
        />
      {/if}
      <LedControls store={leds} {item} {selected} {i18n} layer={1010} onDone={closePopover} />
    </div>
  {/if}
</div>

<style>
  .chip-root {
    position: relative;
    height: 100%;
  }

  .chip {
    --led: var(--accent);
    position: relative;
    display: flex;
    height: 100%;
    min-width: 104px;
    max-width: 220px;
    padding-block: 4px 6px;
    padding-inline: 12px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    overflow: hidden;
    isolation: isolate;
    transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .stripe {
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
  }
  .chip.active .stripe { background: var(--led); }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2px;
    min-width: 0;
    flex: 1;
    z-index: 100;
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
    min-width: 0;
  }
  .state-text {
    margin-inline-start: auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-lg);
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  .kind {
    display: flex;
    line-height: 0;
    color: var(--text-muted);
    opacity: 0.55;
    flex-shrink: 0;
  }
  .kind.lit {
    opacity: 1;
    color: var(--led);
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--led) 60%, transparent));
  }

  .bar {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    height: 3px;
    display: flex;
    z-index: 100;
  }
  .seg { flex: 1; }

  .chip.active {
    background: color-mix(in srgb, var(--led) 8%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--led) 35%, var(--border-color));
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
    position: fixed;
    z-index: 1001;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: var(--space-sm);
    width: 280px;
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .pop-head {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .pop-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .power {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .power:hover { background: var(--bg-surface-hover); }
  .power.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-subtle-strong);
  }
</style>
