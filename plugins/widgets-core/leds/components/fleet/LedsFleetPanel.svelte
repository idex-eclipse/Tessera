<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';

  import { useLeds } from '../../data/use-leds.svelte.ts';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte';
  import { placeChipPopover } from '../../../../shared/popover-align';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import { isLit, OFF, type Rgbw } from '../../lib/led-data';
  import LedStrip from '../shared/LedStrip.svelte';
  import LedControls from '../shared/LedControls.svelte';

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

  const injected = mpuParams ?? params;
  const printerId = injected?.printerId ?? api.printer.id;

  if (!injected?.printerId) {
    console.warn('[fleet-leds] printerId NOT injected — fallback to active printer.');
  }

  const leds = useLeds(api, printerId);
  const klippy = useKlippyState(api, printerId);

  /** Pixel colors of one LED; unknown state reads as fully off. */
  function pixelsOf(id: string, count: number): Rgbw[] {
    return leds.colors[id] ?? Array.from({ length: count }, () => OFF);
  }

  /** Drives the button icon: a filled bulb while any pixel of any LED is lit. */
  let anyLit = $derived(leds.items.some((it) => pixelsOf(it.id, it.count).some(isLit)));
  let disabled = $derived(!klippy.ready);

  // --- popover ---
  let buttonEl = $state<HTMLButtonElement | null>(null);
  let popoverOpen = $state(false);
  let popoverStyle = $state('');
  /** Selected pixels per LED (0-based); empty = the whole chain. */
  let selection = $state<Record<string, number[]>>({});

  function openPopover(): void {
    if (disabled) return;
    const rect = buttonEl?.getBoundingClientRect();
    if (rect) popoverStyle = placeChipPopover(rect, { width: 300, height: 360 });
    popoverOpen = true;
  }
  function closePopover(): void {
    popoverOpen = false;
  }

  $effect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') popoverOpen = false;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<button
  type="button"
  class="fleet-leds-button"
  class:lit={anyLit}
  bind:this={buttonEl}
  {disabled}
  title={i18n.t('fleet.leds.title')}
  aria-expanded={popoverOpen}
  onclick={openPopover}
  onmousedown={(e) => {
    // The fleet card body is scrollable: focusing the button on mousedown would make the
    // browser scroll it fully into view and the card content would jerk. Keyboard focus
    // (and its :focus-visible outline) is unaffected.
    e.preventDefault();
  }}
>
  <span class="bulb" aria-hidden="true">
    <Icon name={anyLit ? 'bulb-on' : 'bulb-off'} size={20} />
  </span>
  <span class="label">{i18n.t('fleet.leds.title')}</span>
</button>

{#if popoverOpen}
  <div class="leds-popover-backdrop" onclick={closePopover} role="presentation"></div>
  <div class="leds-popover" style={popoverStyle}>
    {#if leds.items.length === 0}
      <p class="empty">{i18n.t('fleet.leds.empty')}</p>
    {:else}
      {#each leds.items as it (it.id)}
        {@const pixels = pixelsOf(it.id, it.count)}
        {@const lit = pixels.some(isLit)}
        <div class="led">
          <div class="led-head">
            <span class="led-label" title={it.id}>{it.label}</span>
            <span class="led-kind" dir="ltr">
              {it.kind}{it.count > 1 ? ` × ${it.count}` : ''}{it.hasWhite ? ' · RGBW' : ''}
            </span>
            <button
              class="power"
              class:on={lit}
              title={lit ? i18n.t('widgets.leds.turnOff') : i18n.t('widgets.leds.turnOn')}
              onclick={() => leds.toggle(it.id)}
            >
              <Icon name="kind-power" size={14} />
            </button>
          </div>
          {#if it.count > 1}
            <LedStrip
              {pixels}
              selected={selection[it.id] ?? []}
              allLabel={i18n.t('widgets.leds.allPixels')}
              onSelect={(next) => (selection[it.id] = next)}
            />
          {/if}
          <!-- onDone is omitted on purpose: the popover stays open so several LEDs can be tuned in a row -->
          <LedControls store={leds} item={it} selected={selection[it.id] ?? []} {i18n} layer={1010} />
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  /* The button fills its whole fleet grid cell (default 4x1). */
  .fleet-leds-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    width: 100%;
    height: 100%;
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }
  /* No :active press feedback, matching the other compact fleet buttons. */
  .fleet-leds-button:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    border-color: var(--border-focus);
  }
  .fleet-leds-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .fleet-leds-button:disabled { cursor: default; opacity: 0.6; }

  .fleet-leds-button.lit { color: var(--accent); }

  .bulb {
    display: flex;
    line-height: 0;
    flex-shrink: 0;
  }
  .fleet-leds-button.lit .bulb {
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 60%, transparent));
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-md);
    font-weight: 600;
    /* The label keeps the same text color in both states; only the bulb icon reacts to lit LEDs. */
    color: var(--text-primary);
  }

  /* Fixed positioning keeps the popover out of the fleet card's overflow, same as the chip popover. */
  .leds-popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .leds-popover {
    position: fixed;
    z-index: 1001;
    width: 300px;
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .empty {
    margin: 0;
    padding: var(--space-sm);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
  }

  .led {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    min-width: 0;
  }

  .led-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-width: 0;
  }
  .led-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--text-primary);
  }
  .led-kind {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
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
