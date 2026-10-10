<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useMacros } from '../../use-macros.svelte';
  import PickerSection from '../../../../shared/PickerAccordion.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const macros = useMacros(api);

  let rootEl = $state<HTMLDivElement | null>(null);
  let editMode = $derived(params.edit === '1');

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

  interface Entry {
    name: string;
    label: string;
    hidden: boolean;
  }

  function entryOf(name: string): Entry {
    const item = macros.itemOf(name);
    return { name, label: item.alias || name, hidden: macros.isHidden(name) };
  }

  /** Группы пользователя (порядок как в виджете) → Ungrouped → Hidden (edit). */
  let groups = $derived.by(() => {
    const placed = new Set(placedIds);
    const out: Array<{ id: string; title: string; items: Entry[] }> = [];

    for (const g of macros.viewGroups()) {
      const items = g.macros.filter((n) => !placed.has(n)).map(entryOf);
      if (items.length > 0) out.push({ id: g.id, title: g.name, items });
    }

    const ung = macros.ungrouped().filter((n) => !placed.has(n)).map(entryOf);
    if (ung.length > 0) {
      out.push({ id: '__ungrouped', title: i18n.t('widgets.macros.ungrouped'), items: ung });
    }

    if (editMode) {
      const hid = macros.hiddenList().filter((n) => !placed.has(n)).map(entryOf);
      if (hid.length > 0) {
        out.push({ id: '__hidden', title: i18n.t('widgets.macros.hidden'), items: hid });
      }
    }

    return out;
  });

  function pickMacro(name: string): void {
    const origin = rootEl;
    if (!origin) return;
    origin.dispatchEvent(
      new CustomEvent('mpu:chip-pick', {
        bubbles: true,
        composed: true,
        detail: { id: name },
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
          {#each g.items as m (m.name)}
            <button class="picker-item" class:hidden={m.hidden} onclick={() => pickMacro(m.name)}>
              <span class="picker-name">{m.label}</span>
              {#if m.label !== m.name}
                <span class="picker-real">{m.name}</span>
              {/if}
              {#if m.hidden}
                <span class="picker-badge">{i18n.t('widgets.macros.hidden')}</span>
              {/if}
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
  .picker-item.hidden { opacity: 0.6; }
  .picker-name {
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .picker-real {
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }
  .picker-badge {
    padding: 0 6px;
    border-radius: 4px;
    background: var(--bg-surface-active);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .picker-empty {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    padding: var(--space-sm);
    text-align: center;
  }
</style>