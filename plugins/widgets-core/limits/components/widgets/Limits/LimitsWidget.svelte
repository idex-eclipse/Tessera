<script lang="ts">
  import { useWidget, useI18n } from '../../../../../../plugin-sdk/src/svelte/index';

  import SectionAccordion from '../../../../../shared/accordion/SectionAccordion.svelte';
  import { useAccordionState } from '../../../../../shared/accordion/use-accordion-state.svelte.ts';
  import SliderField from '../../../../../shared/slider-field/SliderField.svelte';
  import SliderGrid from '../../../../../shared/slider-field/SliderGrid.svelte';
  import { SECTION_GAP, sectionsNeedAccordion, sliderColumns } from '../../../../../shared/slider-field/slider-layout';
  import { observeWidgetBox, type WidgetBox } from '../../../../../shared/responsive/observe-widget-box';
  import KlipperNotReady from '../../../../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import { useLimits } from '../../../data/use-limits.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useLimits(api);
  const klippy = useKlippyState(api);
  const sections = useAccordionState(api, 'limits.sections');

  let limDef = $derived(store.meta.defaults);

  let box = $state<WidgetBox>({ width: 0, height: 0, narrow: false });
  let speedHeight = $state(0);
  let cornersHeight = $state(0);

  let columns = $derived(sliderColumns(box.width, box.narrow));
  let accordion = $derived(sectionsNeedAccordion([speedHeight, cornersHeight], SECTION_GAP, box.height));
</script>

{#if !klippy.ready}
  <KlipperNotReady />
{:else}
  <div class="limits-box" use:observeWidgetBox={(b) => (box = b)}>
    <div class="limits">
      <SectionAccordion
        title={i18n.t('widgets.limits.groupSpeed')}
        {accordion}
        open={sections.isOpen('speed', box.narrow, true)}
        onToggle={() => sections.toggle('speed', box.narrow, true)}
        bind:contentHeight={speedHeight}
      >
        <SliderGrid {columns}>
          <SliderField
            label={i18n.t('widgets.limits.velocity')}
            value={store.limits.velocity}
            min={1}
            max={Math.max(limDef.velocity, 1)}
            step={1}
            unit="mm/s"
            onCommit={(v) => store.setLimit({ velocity: v })}
            onReset={() => store.setLimit({ velocity: limDef.velocity })}
          />
          <SliderField
            label={i18n.t('widgets.limits.accel')}
            value={store.limits.accel}
            min={1}
            max={Math.max(limDef.accel, 1)}
            step={1}
            unit="mm/s²"
            onCommit={(v) => store.setLimit({ accel: v })}
            onReset={() => store.setLimit({ accel: limDef.accel })}
          />
        </SliderGrid>
      </SectionAccordion>

      <SectionAccordion
        title={i18n.t('widgets.limits.groupCorners')}
        {accordion}
        open={sections.isOpen('corners', box.narrow, false)}
        onToggle={() => sections.toggle('corners', box.narrow, false)}
        bind:contentHeight={cornersHeight}
      >
        <SliderGrid {columns}>
          <SliderField
            label={i18n.t('widgets.limits.scv')}
            value={store.limits.scv}
            min={0.1}
            max={Math.max(limDef.scv, 0.1)}
            step={0.1}
            unit="mm/s"
            decimals={1}
            onCommit={(v) => store.setLimit({ scv: v })}
            onReset={() => store.setLimit({ scv: limDef.scv })}
          />
          <SliderField
            label={i18n.t('widgets.limits.mcr')}
            value={store.limits.mcr * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onCommit={(v) => store.setLimit({ mcr: v / 100 })}
            onReset={() => store.setLimit({ mcr: limDef.mcr })}
          />
        </SliderGrid>
      </SectionAccordion>
    </div>
  </div>
{/if}

<style>
  :global(mpu-widgets-limits) {
    display: block;
    height: 100%;
  }

  .limits-box {
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
    padding: var(--space-xs);
  }

  .limits {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    height: 100%;
    overflow-y: auto;
    min-height: 0;
  }
</style>
