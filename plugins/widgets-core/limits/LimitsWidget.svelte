<script lang="ts">
  import { useWidget, useI18n } from '../../../plugin-sdk/src/svelte/index';

  import SliderField from '../../shared/slider-field/SliderField.svelte';
  import KlipperNotReady from '../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../shared/klippy-state/use-klippy-state.svelte.ts';
  import { useLimits } from './use-limits.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useLimits(api);
  const klippy = useKlippyState(api);

  let limDef = $derived(store.meta.defaults);
</script>

{#if !klippy.ready}
  <KlipperNotReady />
{:else}
  <div class="limits">
    <div class="sf-grid">
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
    </div>
  </div>
{/if}

<style>
  :global(mpu-widgets-limits) {
    display: block;
    height: 100%;
  }

  .limits {
    height: 100%;
    overflow-y: auto;
    min-height: 0;
    padding: var(--space-xs);
  }

  .sf-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm) var(--space-md);
  }
</style>