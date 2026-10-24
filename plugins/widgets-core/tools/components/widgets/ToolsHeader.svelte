<script lang="ts">
  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import HeaderHelp from '../../../../shared/header-help/HeaderHelp.svelte';

  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { useToolhead } from '../../use-toolhead.svelte.ts';
  import { isRtl } from '../../../../shared/popover-align';

  import '../../../../shared/input/inputs.css';

  const api = useWidget();
  const i18n = useI18n();
  const store = useToolhead(api);
  const klippy = useKlippyState(api);

  let menuOpen = $state(false);
  let confirmFM = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let pos = $state<{ top: number; left?: number; right?: number }>({ top: 0, right: 0 });

  function toggleMenu(): void {
    if (!menuOpen && btnEl) {
      const r = btnEl.getBoundingClientRect();
      // меню выравнивается по краю кнопки со стороны конца (в RTL — по левому)
      pos = isRtl()
        ? { top: r.bottom + 4, left: Math.max(8, r.left) }
        : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) };
    }
    menuOpen = !menuOpen;
  }

  function setStep(i: number, raw: string): void {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    const arr = [...store.ui.steps];
    arr[i] = n;
    store.setSteps(arr);
  }

  function setFeed(key: 'feedXY' | 'feedZ', raw: string): void {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) store.setFeed(key, n);
  }
</script>

<div class="hdr">
  <button
    class="fm-btn"
    class:active={store.forceMove}
    disabled={!klippy.ready}
    title={!klippy.ready ? i18n.t('common.klipperNotReady') : undefined}
    onclick={() => {
      if (store.forceMove) store.setForceMove(false);
      else confirmFM = true;
    }}
  >
    {i18n.t('widgets.tools.forceMove')}
  </button>

  <button
    class="fm-btn"
    disabled={!klippy.ready}
    title={!klippy.ready ? i18n.t('common.klipperNotReady') : undefined}
    onclick={() => store.motorsOff()}
  >
    {i18n.t('widgets.tools.motorsOff')}
  </button>

  <button
    class="hdr-btn"
    class:active={menuOpen}
    bind:this={btnEl}
    onclick={toggleMenu}
    title={i18n.t('widgets.tools.settings')}
  >
    <Icon name="settings" size={15} />
  </button>

  <HeaderHelp title={i18n.t('widgets.tools.help.Title')}>
    <h4>{i18n.t('widgets.tools.help.MoveTitle')}</h4>
    <p>{i18n.t('widgets.tools.help.MoveText')}</p>

    <h4>{i18n.t('widgets.tools.help.PositionTitle')}</h4>
    <p>{i18n.t('widgets.tools.help.PositionText')}</p>

    <h4>{i18n.t('widgets.tools.help.ToolsTitle')}</h4>
    <p>{i18n.t('widgets.tools.help.ToolsText')}</p>

    <h4>{i18n.t('widgets.tools.help.DirectTitle')}</h4>
    <p>{i18n.t('widgets.tools.help.DirectText')}</p>

    <h4>{i18n.t('widgets.tools.help.ForceMoveTitle')}</h4>
    <p class="warn">{i18n.t('widgets.tools.help.ForceMoveText')}</p>
  </HeaderHelp>
</div>

{#if menuOpen}
  <div class="menu-backdrop" onclick={() => (menuOpen = false)} role="presentation"></div>

  <div
    class="menu"
    style:top="{pos.top}px"
    style:left={pos.left !== undefined ? `${pos.left}px` : undefined}
    style:right={pos.right !== undefined ? `${pos.right}px` : undefined}
  >
    <label class="menu-field">
      <span>{i18n.t('widgets.tools.controlType')}</span>
      <select
        value={store.ui.style}
        onchange={(e) => store.setStyle(e.currentTarget.value as 'cross' | 'rows')}
      >
        <option value="cross">{i18n.t('widgets.tools.styleCross')}</option>
        <option value="rows">{i18n.t('widgets.tools.styleRows')}</option>
      </select>
    </label>

    {#if store.ui.style === 'cross'}
      <div class="menu-title">{i18n.t('widgets.tools.invert')}</div>
      <div class="invert-row">
        {#each (['x', 'y', 'z'] as const) as axis (axis)}
          <label class="menu-check">
            <input
              type="checkbox"
              checked={store.ui.invert[axis]}
              onchange={(e) => store.setInvert(axis, e.currentTarget.checked)}
            />
            {axis.toUpperCase()}
          </label>
        {/each}
      </div>
    {/if}

    <div class="menu-title">{i18n.t('widgets.tools.steps')}</div>
    <div class="steps-grid">
      {#each store.ui.steps as s, i (i)}
        <label class="mpu-field step-field">
          <input
            class="mpu-input"
            type="number"
            min="0.001"
            step="any"
            value={s}
            onchange={(e) => setStep(i, e.currentTarget.value)}
          />
          <span class="mpu-field-unit">mm</span>
        </label>
      {/each}
    </div>

    <div class="menu-title">{i18n.t('widgets.tools.feeds')}</div>
    <label class="mpu-field feed-field">
      <span class="mpu-field-legend">{i18n.t('widgets.tools.feedXY')}</span>
      <input
        class="mpu-input"
        type="number"
        min="1"
        step="any"
        value={store.ui.feedXY}
        onchange={(e) => setFeed('feedXY', e.currentTarget.value)}
      />
      <span class="mpu-field-unit">mm/s</span>
    </label>
    <label class="mpu-field feed-field">
      <span class="mpu-field-legend">{i18n.t('widgets.tools.feedZ')}</span>
      <input
        class="mpu-input"
        type="number"
        min="0.1"
        step="any"
        value={store.ui.feedZ}
        onchange={(e) => setFeed('feedZ', e.currentTarget.value)}
      />
      <span class="mpu-field-unit">mm/s</span>
    </label>

    <div class="menu-title">{i18n.t('widgets.tools.directTitle')}</div>
    <label class="menu-check">
      <input
        type="checkbox"
        checked={store.ui.directMode}
        onchange={(e) => store.setDirectMode(e.currentTarget.checked)}
      />
      {i18n.t('widgets.tools.directMode')}
    </label>

    {#if store.ui.directMode}
      <label class="mpu-field direct-axis-field">
        <span class="mpu-field-legend">{i18n.t('widgets.tools.directAxis')}</span>
        <input
          class="mpu-input"
          type="text"
          maxlength="1"
          value={store.ui.directAxis}
          onchange={(e) => {
            store.setDirectAxis(e.currentTarget.value);
            e.currentTarget.value = store.ui.directAxis;
          }}
        />
      </label>
      <p class="menu-hint">{i18n.t('widgets.tools.directHint')}</p>
    {/if}
  </div>
{/if}

<ConfirmDialog
  open={confirmFM}
  title={i18n.t('widgets.tools.forceMove')}
  message={i18n.t('widgets.tools.forceMoveWarn')}
  confirmLabel={i18n.t('widgets.tools.forceMove')}
  danger={true}
  onConfirm={() => store.setForceMove(true)}
  onClose={() => (confirmFM = false)}
/>

<style>
  .hdr {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .fm-btn {
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .fm-btn:hover {
    background: var(--bg-surface-hover);
  }

  .fm-btn.active {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
    color: var(--danger);
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
    width: 264px;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .menu-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .menu-field select {
    padding: 2px var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .menu-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .menu-hint {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .invert-row {
    display: flex;
    gap: var(--space-md);
    flex-wrap: wrap;
  }

  .menu-check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    font-family: monospace;
    color: var(--text-primary);
    cursor: pointer;
  }

  .steps-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .step-field {
    margin-top: 0;
    padding: 3px 6px;
  }

  .step-field .mpu-input {
    width: auto;
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
  }

  .step-field .mpu-field-unit {
    font-size: var(--font-size-sm);
  }

  .feed-field {
    padding: 10px 8px 6px;
  }

  .feed-field .mpu-input {
    width: auto;
    flex: 1;
    min-width: 0;
  }

  .direct-axis-field .mpu-input {
    text-transform: uppercase;
    text-align: center;
    font-family: monospace;
    max-width: 56px;
  }
</style>