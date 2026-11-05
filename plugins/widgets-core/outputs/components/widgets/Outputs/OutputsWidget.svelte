<script lang="ts">
  import { useWidget, useI18n } from '../../../../../../plugin-sdk/src/svelte/index';

  import SectionAccordion from '../../../../../shared/accordion/SectionAccordion.svelte';
  import { useAccordionState } from '../../../../../shared/accordion/use-accordion-state.svelte.ts';
  import SliderField from '../../../../../shared/slider-field/SliderField.svelte';
  import SliderGrid from '../../../../../shared/slider-field/SliderGrid.svelte';
  import { SECTION_GAP, sectionsNeedAccordion, sliderColumns } from '../../../../../shared/slider-field/slider-layout';
  import { observeWidgetBox, type WidgetBox } from '../../../../../shared/responsive/observe-widget-box';
  import Icon from '../../../../../shared/icons/Icon.svelte';
  import KlipperNotReady from '../../../../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import { useOutputs } from '../../../data/use-outputs.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useOutputs(api);
  const klippy = useKlippyState(api);
  const sections = useAccordionState(api, 'outputs.sections');

  function speedOf(id: string): number {
    return store.values[id] ?? 0;
  }

  let controlled = $derived(store.items.filter((it) => !it.readOnly));
  let automatic = $derived(store.items.filter((it) => it.readOnly));

  let box = $state<WidgetBox>({ width: 0, height: 0, narrow: false });
  let controlledHeight = $state(0);
  let automaticHeight = $state(0);

  let columns = $derived(sliderColumns(box.width, box.narrow));
  let accordion = $derived(
    sectionsNeedAccordion(
      [
        ...(controlled.length > 0 ? [controlledHeight] : []),
        ...(automatic.length > 0 ? [automaticHeight] : []),
      ],
      SECTION_GAP,
      box.height,
    ),
  );
</script>

{#if !klippy.ready}
  <KlipperNotReady />
{:else if store.items.length === 0}
  <p class="empty">{i18n.t('widgets.outputs.empty')}</p>
{:else}
  <div class="outputs-box" use:observeWidgetBox={(b) => (box = b)}>
    <div class="outputs">
      {#if controlled.length > 0}
        <SectionAccordion
          title={i18n.t('widgets.outputs.groupControlled')}
          {accordion}
          open={sections.isOpen('controlled', box.narrow, true)}
          onToggle={() => sections.toggle('controlled', box.narrow, true)}
          bind:contentHeight={controlledHeight}
        >
          <SliderGrid {columns}>
            {#each controlled as it (it.id)}
              {#if it.kind === 'output_pin'}
                <SliderField
                  label={it.label}
                  value={store.values[it.id] ?? it.min}
                  min={it.min}
                  max={it.max}
                  step={it.step}
                  decimals={it.decimals}
                  onCommit={(v) => store.setValue(it.id, v)}
                  onReset={() => store.setValue(it.id, Math.max(it.min, 0))}
                />
              {:else}
                <SliderField
                  label={it.kind === 'fan' ? i18n.t('widgets.outputs.fan') : it.label}
                  value={Math.round((store.values[it.id] ?? 0) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  onCommit={(v) => store.setValue(it.id, v / 100)}
                  onReset={() => store.setValue(it.id, 0)}
                />
              {/if}
            {/each}
          </SliderGrid>
        </SectionAccordion>
      {/if}

      {#if automatic.length > 0}
        <SectionAccordion
          title={i18n.t('widgets.outputs.groupAuto')}
          {accordion}
          open={sections.isOpen('automatic', box.narrow, false)}
          onToggle={() => sections.toggle('automatic', box.narrow, false)}
          bind:contentHeight={automaticHeight}
        >
          <SliderGrid {columns}>
            {#each automatic as it (it.id)}
              <!-- авто-вентилятор: индикаторная строка, без слайдера -->
              <div class="auto-row" title={i18n.t('widgets.outputs.autoNote')}>
                <span class="auto-icon" class:lit={speedOf(it.id) > 0.001}>
                  <Icon
                    name="kind-fan"
                    size={30}
                    style={`--spin-d: ${(1.9 - 1.5 * speedOf(it.id)).toFixed(2)}s`}
                  />
                </span>
                <span class="auto-label">{it.label}</span>
                <span class="auto-value">
                  {speedOf(it.id) > 0.001 ? `${Math.round(speedOf(it.id) * 100)}%` : i18n.t('widgets.outputs.stateOff')}
                </span>
              </div>
            {/each}
          </SliderGrid>
        </SectionAccordion>
      {/if}
    </div>
  </div>
{/if}

<style>
  :global(mpu-widgets-outputs) {
    display: block;
    height: 100%;
  }

  .outputs-box {
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
    padding: var(--space-xs);
  }

  .outputs {
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

  .auto-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-width: 0;
    padding: 3px var(--space-xs);
    border-radius: var(--radius-sm);
  }
  .auto-icon {
    display: flex;
    line-height: 0;
    color: var(--text-muted);
    opacity: 0.55;
    flex-shrink: 0;
  }
  .auto-icon.lit { opacity: 1; color: var(--cool); }
  .auto-label {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .auto-value {
    flex-shrink: 0;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .auto-row:hover .auto-value { color: var(--cool); }
</style>
