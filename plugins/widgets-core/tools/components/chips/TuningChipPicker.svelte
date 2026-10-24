<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useToolhead } from '../../use-toolhead.svelte';
  import PickerSection from '../../../../shared/PickerAccordion.svelte';

  type Item = { id: string; label: string };

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const tools = useToolhead(api);

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
    const extruder: Item[] = [
      { id: 'pressure_advance', label: i18n.t('widgets.tools.pa') },
    ];
    if (tools.meta.hasRetraction) {
      extruder.push({ id: 'retraction', label: i18n.t('widgets.tools.retraction') });
    }
    const speedFlow: Item[] = [
      { id: 'flow', label: i18n.t('widgets.tools.flow') },
      { id: 'speed', label: i18n.t('widgets.tools.speed') },
    ];
    return [
      { id: 'extruder', title: i18n.t('widgets.tools.tuning.groupExtruder'), items: extruder },
      { id: 'speedflow', title: i18n.t('widgets.tools.speed-flow'), items: speedFlow },
    ]
      .map((g) => ({ ...g, items: g.items.filter((it) => !placed.has(it.id)) }))
      .filter((g) => g.items.length > 0);
  });

  function pick(id: string): void {
    if (!rootEl) return;
    rootEl.dispatchEvent(
      new CustomEvent('mpu:chip-pick', {
        bubbles: true, composed: true, detail: { id },
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
          {#each g.items as it (it.id)}
            <button class="picker-item" onclick={() => pick(it.id)}>
              <span class="picker-name">{it.label}</span>
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
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: transparent; cursor: pointer; text-align: start; font-size: var(--font-size-sm);
    transition: background var(--transition-fast);
  }

  .picker-item:hover { background: var(--bg-surface-hover); }
  .picker-name { font-weight: 600; color: var(--text-primary); }
  
  .picker-empty {
    color: var(--text-muted); font-size: var(--font-size-sm);
    padding: var(--space-sm); text-align: center;
  }
</style>