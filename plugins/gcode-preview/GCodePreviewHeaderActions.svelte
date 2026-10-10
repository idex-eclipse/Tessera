<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';
  import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';

  import HeaderHelp from '../shared/header-help/HeaderHelp.svelte';

  import Icon from '../shared/icons/Icon.svelte';
  import { clearPreview } from './viewer/preview-ui-state.svelte';
  import { useExcludeObjects } from './viewer/use-exclude-objects.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const klippy = useKlippyState(api);
  const excludeStore = useExcludeObjects(api);

  let listOpen = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let pos = $state({ top: -9999, right: -9999 });

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
    const rightPreferred = Math.max(8, window.innerWidth - r.right);
    const right = Math.min(rightPreferred, Math.max(8, window.innerWidth - mw - 8));
    pos = { top, right };
  }

  function toggleList(): void {
    if (!listOpen) pos = { top: -9999, right: -9999 };
    listOpen = !listOpen;
  }

  $effect(() => {
    if (!listOpen || !menuEl) return;
    place();
    const re = () => place();
    window.addEventListener('resize', re);
    document.addEventListener('scroll', re, true);
    return () => {
      window.removeEventListener('resize', re);
      document.removeEventListener('scroll', re);
    };
  });

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') listOpen = false;
  }

  $effect(() => {
    if (!listOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="hdr">
  <button
    class="icon-btn"
    title={i18n.t('gcodePreview.clear')}
    onclick={() => clearPreview(api, 'widget')}
  >
    <Icon name="x" />
  </button>

  {#if excludeStore.available && excludeStore.objects.length > 0}
    <button
      class="icon-btn"
      class:active={listOpen}
      bind:this={btnEl}
      title={i18n.t('gcodePreview.objects')}
      onclick={toggleList}
    >
      <Icon name="list" size={16} />
    </button>
  {/if}
  <HeaderHelp title={i18n.t('gcodePreview.help.Title')}>
    <h4>{i18n.t('gcodePreview.help.FollowTitle')}</h4>
    <p>{i18n.t('gcodePreview.help.FollowText')}</p>

    <h4>{i18n.t('gcodePreview.help.LayersTitle')}</h4>
    <p>{i18n.t('gcodePreview.help.LayersText')}</p>

    <h4>{i18n.t('gcodePreview.help.ColorsTitle')}</h4>
    <p>{i18n.t('gcodePreview.help.ColorsText')}</p>

    <h4>{i18n.t('gcodePreview.help.ExcludeTitle')}</h4>
    <p>{i18n.t('gcodePreview.help.ExcludeText')}</p>
  </HeaderHelp>
</div>

{#if listOpen}
  <div class="menu-backdrop" onclick={() => (listOpen = false)} role="presentation"></div>

  <div
    class="obj-menu"
    bind:this={menuEl}
    style:top="{pos.top}px"
    style:right="{pos.right}px"
    role="menu"
  >
    <div class="obj-menu-title">{i18n.t('gcodePreview.objects')}</div>
    {#each excludeStore.objects as o (o.name)}
      <button
        class="obj-item"
        class:excluded={o.excluded}
        class:current={o.current}
        disabled={!klippy.ready || o.excluded}
        title={o.excluded
          ? i18n.t('gcodePreview.excluded')
          : !klippy.ready
            ? i18n.t('common.klipperNotReady')
            : i18n.t('gcodePreview.excludeObject', { name: o.name })}
        onclick={() => {
          if (klippy.ready && !o.excluded) void excludeStore.exclude(o.name);
        }}
      >
        <span class="obj-name">{o.name}</span>
        {#if o.current}<span class="obj-badge current">{i18n.t('gcodePreview.current')}</span>{/if}
        {#if o.excluded}<span class="obj-badge excluded">{i18n.t('gcodePreview.excluded')}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .hdr {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .icon-btn {
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
  }
  .icon-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .icon-btn.active { background: var(--accent); color: #fff; }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .obj-menu {
    position: fixed;
    z-index: 461;
    min-width: 260px;
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

  .obj-menu-title {
    padding: var(--space-xs) var(--space-sm);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .obj-item {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: monospace;
    text-align: start;
    cursor: pointer;
  }

  .obj-item:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .obj-item:disabled { opacity: 0.5; cursor: not-allowed; }

  .obj-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .obj-item.current .obj-name { color: var(--warning); font-weight: 600; }
  .obj-item.excluded .obj-name { color: var(--text-muted); text-decoration: line-through; }

  .obj-badge {
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .obj-badge.current {
    background: color-mix(in srgb, var(--warning) 15%, transparent);
    color: var(--warning);
  }

  .obj-badge.excluded {
    background: var(--bg-surface-hover);
    color: var(--text-muted);
  }
</style>