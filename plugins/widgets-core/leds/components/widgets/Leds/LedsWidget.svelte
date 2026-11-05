<script lang="ts">
  import { useWidget, useI18n } from '../../../../../../plugin-sdk/src/svelte/index';

  import SectionAccordion from '../../../../../shared/accordion/SectionAccordion.svelte';
  import { useAccordionState } from '../../../../../shared/accordion/use-accordion-state.svelte.ts';
  import { SECTION_GAP, sectionsNeedAccordion } from '../../../../../shared/slider-field/slider-layout';
  import { observeWidgetBox, type WidgetBox } from '../../../../../shared/responsive/observe-widget-box';
  import Icon from '../../../../../shared/icons/Icon.svelte';
  import KlipperNotReady from '../../../../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import { isLit, OFF } from '../../../lib/led-data';
  import { useLeds } from '../../../data/use-leds.svelte.ts';
  import LedStrip from '../../shared/LedStrip.svelte';
  import LedControls from '../../shared/LedControls.svelte';

  const api = useWidget();
  const i18n = useI18n();
  const store = useLeds(api);
  const klippy = useKlippyState(api);
  const sections = useAccordionState(api, 'leds.sections');

  /** выбор пикселей per-LED; пусто = вся цепочка */
  let selection = $state<Record<string, number[]>>({});
  let heights = $state<Record<string, number>>({});

  let box = $state<WidgetBox>({ width: 0, height: 0, narrow: false });
  let accordion = $derived(
    store.items.length > 1 &&
      sectionsNeedAccordion(
        store.items.map((it) => heights[it.id] ?? 0),
        SECTION_GAP,
        box.height,
      ),
  );

  function pixelsOf(id: string, count: number) {
    return store.colors[id] ?? Array.from({ length: count }, () => OFF);
  }
</script>

{#if !klippy.ready}
  <KlipperNotReady />
{:else if store.items.length === 0}
  <p class="empty">{i18n.t('widgets.leds.empty')}</p>
{:else}
  <div class="leds-box" use:observeWidgetBox={(b) => (box = b)}>
    <div class="leds">
      {#each store.items as it, n (it.id)}
        {@const pixels = pixelsOf(it.id, it.count)}
        {@const lit = pixels.some(isLit)}
        <SectionAccordion
          title={it.label}
          {accordion}
          open={sections.isOpen(it.id, box.narrow, n === 0)}
          onToggle={() => sections.toggle(it.id, box.narrow, n === 0)}
          bind:contentHeight={heights[it.id]}
        >
          <div class="led">
            <div class="led-head">
              {#if !accordion}
                <span class="led-label" title={it.id}>{it.label}</span>
              {/if}
              <span class="led-kind" dir="ltr">
                {it.kind}{it.count > 1 ? ` × ${it.count}` : ''}{it.hasWhite ? ' · RGBW' : ''}
              </span>
              <button
                class="power"
                class:on={lit}
                title={lit ? i18n.t('widgets.leds.turnOff') : i18n.t('widgets.leds.turnOn')}
                onclick={() => store.toggle(it.id)}
              >
                <Icon name="kind-power" size={16} />
              </button>
            </div>

            <LedStrip
              {pixels}
              selected={selection[it.id] ?? []}
              allLabel={i18n.t('widgets.leds.allPixels')}
              onSelect={(next) => (selection[it.id] = next)}
            />
            {#if (selection[it.id] ?? []).length > 0}
              <span class="sel-note">
                {i18n.t('widgets.leds.pixelsSelected', { n: selection[it.id]!.length })}
              </span>
            {/if}

            <LedControls {store} item={it} selected={selection[it.id] ?? []} {i18n} />
          </div>
        </SectionAccordion>
      {/each}
    </div>
  </div>
{/if}

<style>
  :global(mpu-widgets-leds) {
    display: block;
    height: 100%;
  }

  .leds-box {
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
    padding: var(--space-xs);
  }

  .leds {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    height: 100%;
    overflow-y: auto;
    min-height: 0;
  }

  .empty {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
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
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }
  .power:hover { background: var(--bg-surface-hover); }
  .power.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-subtle-strong);
  }

  .sel-note {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }
</style>
