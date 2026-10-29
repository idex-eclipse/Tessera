<script lang="ts">
  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import HeaderHelp from '../../../../shared/header-help/HeaderHelp.svelte';

  import { isRtl } from '../../../../shared/popover-align';

  import { useTemperaturePrefs, type TempColumns, type TempViewMode } from '../../use-temperature.svelte';

  const api = useWidget();
  const i18n = useI18n();
  const prefs = useTemperaturePrefs(api);

  let menuOpen = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let pos = $state({ top: -9999, left: -9999 });

  const COLUMNS: Array<{ key: keyof TempColumns; label: string }> = [
    { key: 'power', label: 'widgets.temperature.power' },
    { key: 'rate', label: 'widgets.temperature.rate' },
    { key: 'current', label: 'widgets.temperature.current' },
    { key: 'target', label: 'widgets.temperature.target' },
    { key: 'hold', label: 'widgets.temperature.heaterTime' },
  ];

  const VIEWS: Array<{ key: TempViewMode; label: string }> = [
    { key: 'auto', label: 'widgets.temperature.viewAuto' },
    { key: 'table', label: 'widgets.temperature.viewTable' },
    { key: 'cards', label: 'widgets.temperature.viewCards' },
  ];

  /**
   * Flip по вертикали + клампы: меню не выходит за вьюпорт (виджет может быть внизу).
   * По горизонтали выравнивается по краю кнопки со стороны конца (в RTL — по левому).
   */
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

    const preferred = isRtl() ? r.left : r.right - mw;
    const left = Math.max(8, Math.min(preferred, window.innerWidth - mw - 8));

    pos = { top, left };
  }

  function toggleMenu(): void {
    if (!menuOpen) pos = { top: -9999, left: -9999 }; // без вспышки в старой точке
    menuOpen = !menuOpen;
  }

  $effect(() => {
    if (!menuOpen || !menuEl) return;
    place();
    const re = () => place();
    window.addEventListener('resize', re);
    document.addEventListener('scroll', re, true); // capture: скроллят контейнеры
    return () => {
      window.removeEventListener('resize', re);
      document.removeEventListener('scroll', re, true); // флаг должен совпадать, иначе слушатель утекает
    };
  });

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') menuOpen = false;
  }

  $effect(() => {
    if (!menuOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function toggleColumn(key: keyof TempColumns): void {
    prefs.setColumn(key, !prefs.columns[key]);
  }
</script>

<div class="hdr">
  <button
    class="hdr-btn"
    class:active={menuOpen}
    bind:this={btnEl}
    title={i18n.t('widgets.temperature.settings')}
    onclick={toggleMenu}
  >
    <Icon name="settings" size={15} />
  </button>

  <HeaderHelp title={i18n.t('widgets.temperature.help.Title')}>
    <h4>{i18n.t('widgets.temperature.help.ChartTitle')}</h4>
    <p>{i18n.t('widgets.temperature.help.ChartText')}</p>

    <h4>{i18n.t('widgets.temperature.help.TargetTitle')}</h4>
    <p>{i18n.t('widgets.temperature.help.TargetText')}</p>

    <h4>{i18n.t('widgets.temperature.help.ViewTitle')}</h4>
    <p>{i18n.t('widgets.temperature.help.ViewText')}</p>

    <h4>{i18n.t('widgets.temperature.help.ColumnsTitle')}</h4>
    <p>{i18n.t('widgets.temperature.help.ColumnsText')}</p>

    <h4>{i18n.t('widgets.temperature.help.HoldTitle')}</h4>
    <p>{i18n.t('widgets.temperature.help.HoldText')}</p>
  </HeaderHelp>
</div>

{#if menuOpen}
  <div class="menu-backdrop" onclick={() => (menuOpen = false)} role="presentation"></div>

  <div
    class="menu"
    bind:this={menuEl}
    style:top="{pos.top}px"
    style:left="{pos.left}px"
    role="menu"
  >
    <div class="menu-title">{i18n.t('widgets.temperature.view')}</div>

    {#each VIEWS as v (v.key)}
      <button
        class="menu-item"
        class:checked={prefs.viewMode === v.key}
        role="menuitemradio"
        aria-checked={prefs.viewMode === v.key}
        onclick={() => prefs.setViewMode(v.key)}
      >
        <span class="check">{prefs.viewMode === v.key ? '●' : ''}</span>
        {i18n.t(v.label)}
      </button>
    {/each}

    <div class="menu-sep"></div>
    <div class="menu-title">{i18n.t('widgets.temperature.columns')}</div>

    {#each COLUMNS as col (col.key)}
      <button
        class="menu-item"
        class:checked={prefs.columns[col.key]}
        role="menuitemcheckbox"
        aria-checked={prefs.columns[col.key]}
        onclick={() => toggleColumn(col.key)}
      >
        <span class="check">{prefs.columns[col.key] ? '✓' : ''}</span>
        {i18n.t(col.label)}
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
    min-width: 210px;
    max-height: calc(100vh - 16px);
    max-height: calc(100dvh - 16px);
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

  .menu-sep {
    height: 1px;
    margin: var(--space-xs) 0;
    background: var(--border-color);
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
  }

  /* сенсорный указатель: зона нажатия ≥ 36px */
  @media (pointer: coarse) {
    .hdr-btn { width: 36px; height: 36px; }
    .menu-item { min-height: 40px; }
  }
</style>
