<script lang="ts">
  import { onDestroy } from 'svelte';

  import type { PluginApi } from '../../../plugin-sdk/src/types.ts';
  import Icon from '../../shared/icons/Icon.svelte';

  import {
    FIELD_GROUPS,
    DEFAULT_FIELDS,
    readEnabledFields,
    type ProgressMode,
    type StatusFieldId,
  } from '../use-print-status.svelte.ts';

  let { api, showBannerToggle = false }: { api: PluginApi; showBannerToggle?: boolean } =
    $props();

  const i18n = api.i18n;

  let open = $state(false);
  let fieldsOpen = $state(false);
  // inline — отступ от КОНЦА строки (right в LTR, left в RTL): меню выравнивается по кнопке
  let pos = $state({ top: -9999, inline: -9999 });
  let btnEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);

  let mode = $state(api.settings.get<ProgressMode>('status.progressMode') ?? 'file');
  let banner = $state(api.settings.get<boolean>('status.banner') ?? true);
  let fields = $state<StatusFieldId[]>(readEnabledFields(api));

  const off = api.settings.onChange((k, v) => {
    if (k === 'status.progressMode') mode = v as ProgressMode;
    if (k === 'status.banner') banner = Boolean(v);
    if (k === 'status.fields') fields = readEnabledFields(api);
  });
  onDestroy(off);

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (fieldsOpen) fieldsOpen = false;
      else open = false;
    }
  }

  $effect(() => {
    if (!open) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function place(): void {
    const r = btnEl?.getBoundingClientRect();
    const el = menuEl;
    if (!r || !el) return;

    const mh = el.offsetHeight;
    const mw = el.offsetWidth;

    const spaceBelow = window.innerHeight - r.bottom - 4;
    let top: number;
    if (mh <= spaceBelow) top = r.bottom + 4;
    else if (mh <= r.top - 4) top = r.top - 4 - mh;
    else top = Math.max(8, window.innerHeight - mh - 8);

    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    const preferred = rtl ? Math.max(8, r.left) : Math.max(8, window.innerWidth - r.right);
    const inline = Math.min(preferred, Math.max(8, window.innerWidth - mw - 8));

    pos = { top, inline };
  }

  function toggleOpen(): void {
    if (!open) {
      pos = { top: -9999, inline: -9999 };
      fieldsOpen = false;
    }
    open = !open;
  }

  $effect(() => {
    if (!open || !menuEl) return;
    void fieldsOpen;
    place();

    const re = () => place();
    window.addEventListener('resize', re);
    document.addEventListener('scroll', re, true);
    return () => {
      window.removeEventListener('resize', re);
      document.removeEventListener('scroll', re);
    };
  });

  function setMode(m: ProgressMode): void {
    mode = m;
    api.settings.set('status.progressMode', m);
  }

  function toggleBanner(): void {
    banner = !banner;
    api.settings.set('status.banner', banner);
  }

  function toggleField(f: StatusFieldId): void {
    const next = fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f];
    fields = next;
    api.settings.set('status.fields', next);
  }

  function resetFields(): void {
    fields = [...DEFAULT_FIELDS];
    api.settings.set('status.fields', fields);
  }

  const MODES: Array<{ id: ProgressMode; key: string }> = [
    { id: 'file', key: 'system.status.modeFile' },
    { id: 'time', key: 'system.status.modeTime' },
    { id: 'filament', key: 'system.status.modeFilament' },
  ];

  const FIELD_KEY: Record<StatusFieldId, string> = {
    speed: 'system.status.speed',
    flow: 'system.status.flow',
    filament: 'system.status.filament',
    slicer: 'system.status.slicer',
    elapsed: 'system.status.elapsed',
    total: 'system.status.total',
    layer: 'system.status.layer',
    remaining: 'system.status.remaining',
    eta: 'system.status.eta',
  };
</script>

<button
  class="hdr-btn"
  class:active={open}
  bind:this={btnEl}
  title={i18n.t('system.status.settings')}
  onclick={toggleOpen}
>
  <Icon name="settings" size={15} />
</button>

{#if open}
  <div class="menu-backdrop" onclick={() => (open = false)} role="presentation"></div>

  <div
    class="menu"
    bind:this={menuEl}
    style:top="{pos.top}px"
    style:inset-inline-end="{pos.inline}px"
    role="menu"
  >
    <div class="menu-title">{i18n.t('system.status.progressMode')}</div>

    {#each MODES as m (m.id)}
      <button class="menu-item" class:checked={mode === m.id} onclick={() => setMode(m.id)}>
        <span class="check">{mode === m.id ? '✓' : ''}</span>
        {i18n.t(m.key)}
      </button>
    {/each}

    <div class="menu-sep"></div>

    <!-- секция полей: раскрывается внутри меню (контекстный паттерн, не диалог) -->
    <button
      class="menu-item"
      aria-expanded={fieldsOpen}
      onclick={() => (fieldsOpen = !fieldsOpen)}
    >
      <span class="check"></span>
      <span class="item-label">{i18n.t('system.status.fieldsItem')}</span>
      <span class="chev" class:open={fieldsOpen}>
        <Icon name="chevron-down" size={13} />
      </span>
    </button>

    {#if fieldsOpen}
      {#each FIELD_GROUPS as g (g.id)}
        <div class="menu-title sub">{i18n.t(g.titleKey)}</div>
        {#each g.fields as f (f)}
          <button class="menu-item indent" onclick={() => toggleField(f)}>
            <span class="check">{fields.includes(f) ? '✓' : ''}</span>
            {i18n.t(FIELD_KEY[f])}
          </button>
        {/each}
      {/each}
      <button class="menu-item indent" onclick={resetFields}>
        <span class="check"><Icon name="refresh" size={12} /></span>
        {i18n.t('system.status.fieldsReset')}
      </button>
    {/if}

    {#if showBannerToggle}
      <div class="menu-sep"></div>
      <button class="menu-item" class:checked={banner} onclick={toggleBanner}>
        <span class="check">{banner ? '✓' : ''}</span>
        {i18n.t('system.status.bannerItem')}
      </button>
    {/if}
  </div>
{/if}

<style>
  .hdr-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .hdr-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .hdr-btn.active {
    background: var(--bg-surface-active);
    color: var(--accent);
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .menu {
    position: fixed;
    z-index: 461;
    min-width: 220px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
  }

  .menu-title {
    padding: var(--space-xs) var(--space-sm);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .menu-title.sub {
    padding-top: var(--space-xs);
    font-size: 10px;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: start;
    cursor: pointer;
  }

  .menu-item:hover {
    background: var(--bg-surface-hover);
  }

  .menu-item .check {
    width: 14px;
    flex-shrink: 0;
    color: var(--accent);
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .menu-item.indent {
    padding-inline-start: var(--space-md);
  }

  .item-label {
    flex: 1;
    min-width: 0;
  }

  .chev {
    display: flex;
    color: var(--text-muted);
    transform: rotate(-90deg);
    transition: transform var(--transition-fast);
    flex-shrink: 0;
  }

  .chev.open {
    transform: rotate(0deg);
  }

  .menu-sep {
    height: 1px;
    margin: var(--space-xs) 0;
    background: var(--border-color);
  }

  /* свёрнутый шеврон «указывает в сторону содержимого»: в RTL — влево */
  :global([dir='rtl']) .chev:not(.open) { transform: rotate(90deg); }
</style>
