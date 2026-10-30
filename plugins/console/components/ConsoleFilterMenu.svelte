<script lang="ts">
  import { onDestroy, untrack } from 'svelte';

  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import Icon from '../../shared/icons/Icon.svelte';

  import {
    compileFilters,
    getPrefs,
    setPrefs,
    TEMP_FILTER_PRESET,
  } from '../console-session.svelte';
  import { consoleUi } from '../page-ui-state.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  let printerId = $derived(api.printer.id);
  let prefs = $derived(getPrefs(printerId));
  let entries = $derived(compileFilters(prefs.filters));
  let active = $derived(prefs.filtersEnabled && prefs.filters.length > 0);

  let open = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let panelEl = $state<HTMLElement | null>(null);
  let pos = $state({ left: -9999, top: -9999 });
  let draft = $state('');

  function closeMenu(): void {
    open = false;
  }

  // Alt+F: счётчик из hotkeys; последнее виденное значение — вне реактивности
  let seenToggleSeq = untrack(() => consoleUi.toggleFiltersSeq);
  $effect(() => {
    const seq = consoleUi.toggleFiltersSeq;
    if (seq === seenToggleSeq) return;
    seenToggleSeq = seq;
    open = !untrack(() => open);
  });

  // открытое меню гасит остальные клавиши страницы (иначе Alt+C стёр бы лог из поля шаблона)
  $effect(() => {
    consoleUi.filtersOpen = open;
  });
  onDestroy(() => {
    consoleUi.filtersOpen = false;
  });

  // позиция после рендера панели: под кнопкой, при нехватке места — над ней;
  // в RTL панель выравнивается по правому краю кнопки
  $effect(() => {
    if (!open || !btnEl || !panelEl) return;
    const b = btnEl.getBoundingClientRect();
    const r = panelEl.getBoundingClientRect();
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    const preferred = rtl ? b.right - r.width : b.left;
    const left = Math.max(8, Math.min(preferred, window.innerWidth - r.width - 8));
    let top = b.bottom + 4;
    if (top + r.height > window.innerHeight - 8) {
      top = Math.max(8, b.top - r.height - 4);
    }
    pos = { left, top };
  });

  function patchFilters(filters: string[]): void {
    setPrefs(api, printerId, { filters });
  }

  function addPattern(source: string): void {
    const s = source.trim();
    if (!s || prefs.filters.includes(s)) return;
    patchFilters([...prefs.filters, s]);
  }

  function addDraft(): void {
    addPattern(draft);
    draft = '';
  }

  function removePattern(source: string): void {
    patchFilters(prefs.filters.filter((f) => f !== source));
  }
</script>

<button
  class="ctl"
  class:active
  title={i18n.t('console.filters.title')}
  aria-label={i18n.t('console.filters.title')}
  aria-expanded={open}
  bind:this={btnEl}
  onclick={(e) => {
    e.stopPropagation();
    open = !open;
  }}
>
  <Icon name="filter" size={14} />
</button>

<svelte:window
  onkeydown={(e) => open && e.key === 'Escape' && closeMenu()}
  onclick={() => open && closeMenu()}
  onresize={() => open && closeMenu()}
/>

{#if open}

  <div
    class="filter-panel"
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    bind:this={panelEl}
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-label={i18n.t('console.filters.title')}
  >
    <div class="fp-head">
      <span class="fp-title">{i18n.t('console.filters.title')}</span>
      <button
        class="switch"
        class:on={prefs.filtersEnabled}
        role="switch"
        aria-checked={prefs.filtersEnabled}
        title={i18n.t('console.filters.enable')}
        onclick={() => setPrefs(api, printerId, { filtersEnabled: !prefs.filtersEnabled })}
      >
        <span class="knob"></span>
      </button>
    </div>

    {#if prefs.filters.length === 0}
      <p class="fp-empty">{i18n.t('console.filters.empty')}</p>
    {:else}
      <ul class="fp-list">
        {#each entries as entry (entry.source)}
          <li
            class="fp-row"
            class:invalid={!entry.re}
            title={!entry.re ? i18n.t('console.filters.invalid') : entry.source}
          >
            <span class="fp-pattern">{entry.source}</span>
            <button
              class="fp-x"
              aria-label={i18n.t('console.filters.remove')}
              title={i18n.t('console.filters.remove')}
              onclick={() => removePattern(entry.source)}
            >
              ×
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="fp-add">
      <input
        class="fp-input"
        dir="ltr"
        type="text"
        placeholder={i18n.t('console.filters.addPlaceholder')}
        bind:value={draft}
        onkeydown={(e) => {
          if (e.key === 'Enter') addDraft();
        }}
      />
      <button class="fp-btn" disabled={!draft.trim()} onclick={addDraft}>
        {i18n.t('console.filters.add')}
      </button>
    </div>

    <div class="fp-foot">
      <button
        class="fp-btn fp-ghost"
        disabled={prefs.filters.includes(TEMP_FILTER_PRESET)}
        onclick={() => addPattern(TEMP_FILTER_PRESET)}
      >
        {i18n.t('console.filters.presetTemp')}
      </button>
    </div>
  </div>
{/if}

<style>
  .ctl {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .ctl:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .ctl.active { color: var(--accent); background: var(--bg-surface-active); }

  .filter-panel {
    position: fixed;
    z-index: 400;
    width: 320px;
    max-width: calc(100vw - 16px);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }

  .fp-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
  .fp-title { font-weight: 600; font-size: var(--font-size-md); }
  .fp-empty { margin: 0; color: var(--text-muted); font-style: italic; font-size: var(--font-size-sm); }

  .switch {
    position: relative;
    flex-shrink: 0;
    width: 30px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-surface-hover);
    cursor: pointer;
  }

  .switch .knob {
    position: absolute;
    top: 1px;
    inset-inline-start: 1px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: inset-inline-start var(--transition-fast), background var(--transition-fast);
  }

  .switch.on { border-color: var(--accent); background: var(--bg-surface-active); }
  .switch.on .knob { inset-inline-start: 15px; background: var(--accent); }

  .fp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 180px;
    overflow-y: auto;
  }

  .fp-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 2px var(--space-xs);
    border-radius: var(--radius-xs);
  }

  .fp-row:hover { background: var(--bg-surface-hover); }

  .fp-pattern {
    flex: 1;
    min-width: 0;
    font-family: monospace;
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fp-row.invalid .fp-pattern {
    color: var(--danger);
    text-decoration: underline dashed;
  }

  .fp-x {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 5px;
    border-radius: var(--radius-xs);
  }

  .fp-x:hover { color: var(--danger); background: var(--bg-surface-active); }

  .fp-add { display: flex; gap: var(--space-xs); }

  .fp-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface-hover-no-override);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-sm);
  }

  .fp-input:focus { outline: none; border-color: var(--accent); }

  .fp-btn {
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
    white-space: nowrap;
  }

  .fp-btn:hover:not(:disabled) { background: var(--border-color); }
  .fp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .fp-ghost { background: transparent; border: 1px solid var(--border-color); }

  .fp-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }

  /* сенсорный указатель: зона нажатия ≥ 36px */
  @media (pointer: coarse) {
    .ctl { width: 36px; height: 36px; }
  }
</style>
