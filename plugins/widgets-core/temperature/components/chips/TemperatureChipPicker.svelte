<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useTemperatureData } from '../../use-temperature.svelte';
  import PickerSection from '../../../../shared/PickerAccordion.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const temp = useTemperatureData(api);

  let rootEl = $state<HTMLDivElement | null>(null);

  let placedIds = $derived.by<string[]>(() => {
    try {
      const raw = params.placed;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });

  let groups = $derived.by(() => {
    const placed = new Set(placedIds);
    const avail = temp.sensors.filter((s) => !placed.has(s.name));
    return [
      { id: 'heater', title: i18n.t('widgets.temperature.groupHeater'), items: avail.filter((s) => s.kind === 'heater') },
      { id: 'fan', title: i18n.t('widgets.temperature.groupFan'), items: avail.filter((s) => s.kind === 'fan') },
      { id: 'sensor', title: i18n.t('widgets.temperature.groupSensor'), items: avail.filter((s) => s.kind === 'sensor') },
    ].filter((g) => g.items.length > 0);
  });

  function pickSensor(sensorName: string): void {
    const origin = rootEl;
    if (!origin) return;
    origin.dispatchEvent(
      new CustomEvent('mpu:chip-pick', {
        bubbles: true,
        composed: true,
        detail: { id: sensorName },
      }),
    );
  }
</script>

<div class="picker-root" bind:this={rootEl}>
  {#if groups.length === 0}
    <p class="picker-empty">{i18n.t('chipPickers.empty')}</p>
  {:else}
    <div class="picker-accs">
      {#each groups as g (g.id)}
        <PickerSection title={g.title} count={g.items.length}>
          {#each g.items as sensor (sensor.name)}
            <button class="picker-item" onclick={() => pickSensor(sensor.name)}>
              <span class="picker-name">{sensor.displayName}</span>
              <span class="picker-kind">{sensor.kind}</span>
            </button>
          {/each}
        </PickerSection>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker-root { display: flex; flex-direction: column; gap: var(--space-xs); }
  .picker-accs { display: flex; flex-direction: column; gap: var(--space-xs); }
  .picker-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-size: var(--font-size-sm);
    transition: background var(--transition-fast);
  }
  .picker-item:hover { background: var(--bg-surface-hover); }
  .picker-name { font-weight: 600; color: var(--text-primary); }
  .picker-kind { font-family: monospace; font-size: var(--font-size-sm); color: var(--text-muted); }
  .picker-empty {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    padding: var(--space-sm);
    text-align: center;
  }
</style>