<script lang="ts">
  import { useI18n } from '../../../../plugin-sdk/src/svelte/index';
  import { isRtl } from '../../../shared/popover-align';

  import type { TempColumns, useTemperatureData } from '../use-temperature.svelte';
  import { fmtPower, fmtRate } from '../format';
  import HoldInput from './HoldInput.svelte';
  import TargetInput from './TargetInput.svelte';
  import TempKindIcon from './TempKindIcon.svelte';

  /**
   * Popover карточки датчика (режим «карточки»): строки сверху вниз —
   * заданная температура, время включения, переключатели серий графика, скорость изменения.
   * Время включения — опциональная функция: строка есть только при включённой колонке
   * «Время включения» (пока она скрыта, таймер не работает). Остальное — по типу датчика.
   */
  let {
    anchor,
    name,
    temp,
    columns,
    onClose,
  }: {
    anchor: HTMLElement;
    name: string;
    temp: ReturnType<typeof useTemperatureData>;
    columns: TempColumns;
    onClose: () => void;
  } = $props();

  const i18n = useI18n();

  let s = $derived(temp.sensors.find((x) => x.name === name) ?? null);

  // датчик пропал (смена принтера, перенастройка) — закрываем
  $effect(() => {
    if (!s) onClose();
  });

  let controllable = $derived(s != null && s.kind !== 'sensor');
  let showHold = $derived(columns.hold && s?.kind === 'heater');

  let el = $state<HTMLDivElement | null>(null);
  let pos = $state({ top: -9999, left: -9999 });

  /** Под якорем, при нехватке места — над ним; по горизонтали прижато к краю якоря и в экране. */
  function place(): void {
    if (!el) return;
    const r = anchor.getBoundingClientRect();
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

  $effect(() => {
    if (!el) return;
    place();
    const re = () => place();
    window.addEventListener('resize', re);
    document.addEventListener('scroll', re, true);
    return () => {
      window.removeEventListener('resize', re);
      document.removeEventListener('scroll', re, true);
    };
  });

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if s}
  <div class="backdrop" onclick={onClose} role="presentation"></div>

  <div
    class="pop"
    bind:this={el}
    style:top="{pos.top}px"
    style:left="{pos.left}px"
    role="dialog"
    aria-label={s.displayName}
  >
    <div class="title" style="color: {s.color}">
      <TempKindIcon kind={s.kind} speed={s.kind === 'fan' ? s.power : null} size={18} />
      <span class="title-text">{s.displayName}</span>
    </div>

    {#if controllable}
      <div class="row">
        <span class="lbl">{i18n.t('widgets.temperature.target')}</span>
        <TargetInput block value={s.target} onCommit={(v) => temp.setTarget(s!.name, v)} />
      </div>
    {/if}

    {#if showHold}
      {@const st = temp.holdStatus(s.name)}
      <div class="row">
        <span class="lbl" title={i18n.t('widgets.temperature.holdHint')}>
          {i18n.t('widgets.temperature.heaterTime')}
        </span>
        <HoldInput
          block
          value={temp.holdMinutes[s.name] ?? 0}
          phase={st.phase}
          remainingMs={st.remainingMs}
          onCommit={(m) => temp.setHoldMinutes(s!.name, m)}
        />
      </div>
    {/if}

    <label class="check-row">
      <input
        type="checkbox"
        checked={s.chartVisible}
        onchange={() => temp.toggleChart(s!.name)}
      />
      <span class="check-lbl">{i18n.t('widgets.temperature.tempOnChart')}</span>
    </label>

    {#if controllable}
      <label class="check-row">
        <input
          type="checkbox"
          checked={s.powerVisible}
          onchange={() => temp.togglePower(s!.name)}
        />
        <span class="check-lbl">{i18n.t('widgets.temperature.powerOnChart')}</span>
        <span class="val power-val">{fmtPower(s.power, i18n.t('widgets.temperature.off'))}</span>
      </label>
    {/if}

    <div class="row">
      <span class="lbl">{i18n.t('widgets.temperature.rate')}</span>
      <span class="val">{fmtRate(s.rate)}</span>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .pop {
    position: fixed;
    z-index: 461;
    width: min(280px, calc(100vw - 16px));
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md) var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-width: 0;
    font-weight: 600;
    font-size: var(--font-size-md);
  }

  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-height: 36px;
  }

  .lbl {
    flex: 0 0 8.5em;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .val {
    flex: 1;
    font-variant-numeric: tabular-nums;
    /* числа с «°C», «+», «%» не переставляются знаками в RTL */
    direction: ltr;
    unicode-bidi: isolate;
    text-align: start;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-height: 36px;
    cursor: pointer;
    font-size: var(--font-size-md);
  }

  .check-row input {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .check-lbl { flex: 1; min-width: 0; }

  .power-val {
    flex: 0 0 auto;
    color: var(--text-secondary);
  }

  @media (pointer: coarse) {
    .check-row { min-height: 44px; }
  }
</style>
