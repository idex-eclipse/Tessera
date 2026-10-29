<script lang="ts">
  import { useI18n, useWidget } from '../../../../../plugin-sdk/src/svelte/index';

  import KlipperNotReady from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import TargetInput from '../TargetInput.svelte';
  import HoldInput from '../HoldInput.svelte';
  import TempKindIcon from '../TempKindIcon.svelte';
  import { useTemperatureData, useTemperaturePrefs } from '../../use-temperature.svelte';
  import TemperatureChart from '../TemperatureChart.svelte';
  import SensorPopover from '../SensorPopover.svelte';
  import { observeWidth } from '../../../../shared/responsive/observe-width';
  import { fmtPower, fmtRate, fmtTemp } from '../../format';

  const api = useWidget();
  const i18n = useI18n();

  const temp = useTemperatureData(api);
  const prefs = useTemperaturePrefs(api);

  const { toggleChart, togglePower, setTarget } = temp;

  let hasPrinter = $derived(api.printer.url !== '');
  let ready = $derived(temp.klippyState === 'ready');

  const offLabel = $derived(i18n.t('widgets.temperature.off'));

  // ------------------------------------------------------------------
  // Режим отображения: таблица или карточки
  //
  // «auto»: таблица, пока помещается (ей нужна ширина: имя + включённые столбцы по 120–130px),
  // иначе карточки. Порог считаем по реально включённым столбцам, а не по константе: виджет
  // бывает узким и на широком экране. «table» / «cards» — принудительно (в настройках виджета).
  // ------------------------------------------------------------------

  const NAME_MIN = 150;
  const COL_WIDTH = { power: 120, rate: 120, current: 120, target: 120, hold: 130 } as const;

  let width = $state(0);
  let needed = $derived(
    NAME_MIN +
      (Object.keys(COL_WIDTH) as Array<keyof typeof COL_WIDTH>).reduce(
        (sum, k) => sum + (prefs.columns[k] ? COL_WIDTH[k] : 0),
        0,
      ),
  );
  // width === 0 — ещё не измерено: рисуем таблицу, чтобы не мигать карточками
  let cards = $derived(
    prefs.viewMode === 'cards' || (prefs.viewMode === 'auto' && width > 0 && width < needed),
  );

  let openSensor = $state<string | null>(null);
  let openAnchor = $state<HTMLElement | null>(null);

  function openPopover(name: string, e: MouseEvent): void {
    if (openSensor === name) {
      openSensor = null;
      return;
    }
    openAnchor = e.currentTarget as HTMLElement;
    openSensor = name;
  }

  function closePopover(): void {
    openSensor = null;
  }

  // закрываем popover, когда виджет вернулся к таблице
  $effect(() => {
    if (!cards) openSensor = null;
  });

  /** Вторая строка карточки: текущая / заданная (нагреватели), скорость (вентиляторы), текущая. */
  function cardValue(s: {
    kind: string;
    temperature: number | null;
    target: number | null;
    power: number | null;
  }): { main: string; sub: string } {
    if (s.kind === 'fan') return { main: fmtPower(s.power, offLabel), sub: '' };
    const sub = s.kind !== 'sensor' && s.target != null && s.target > 0 ? `/ ${Math.round(s.target)}°C` : '';
    return { main: fmtTemp(s.temperature), sub };
  }
</script>

<div class="temp-widget" use:observeWidth={(w) => (width = w)}>
  {#if !hasPrinter}
    <p class="notice">{i18n.t('widgets.temperature.noPrinter')}</p>
  {:else if !ready}
    <KlipperNotReady />
  {:else if cards}
    <ul class="sensor-cards">
      {#each temp.sensors as s (s.name)}
        {@const v = cardValue(s)}
        <li>
          <button
            class="sensor-card"
            class:dim={!s.chartVisible}
            class:open={openSensor === s.name}
            style="--sensor-color: {s.color}"
            aria-haspopup="dialog"
            aria-expanded={openSensor === s.name}
            onclick={(e) => openPopover(s.name, e)}
          >
            <span class="card-name">
              <span class="icon-wrap" style="color: {s.color}">
                <TempKindIcon kind={s.kind} speed={s.kind === 'fan' ? s.power : null} size={18} />
              </span>
              <span class="label">{s.displayName}</span>
            </span>
            <span class="card-value">
              <span class="card-main">{v.main}</span>
              {#if v.sub}<span class="card-sub">{v.sub}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>

    {#if openSensor && openAnchor}
      <SensorPopover
        anchor={openAnchor}
        name={openSensor}
        {temp}
        columns={prefs.columns}
        onClose={closePopover}
      />
    {/if}
  {:else}
    <div class="table-wrap">
    <table class="temp-table" style:min-width="{needed}px">
      <colgroup>
        <col />
        {#if prefs.columns.power}<col class="w-power" />{/if}
        {#if prefs.columns.rate}<col class="w-rate" />{/if}
        {#if prefs.columns.current}<col class="w-current" />{/if}
        {#if prefs.columns.target}<col class="w-target" />{/if}
        {#if prefs.columns.hold}<col class="w-hold" />{/if}
      </colgroup>

      <thead>
        <tr>
          <th>{i18n.t('widgets.temperature.sensor')}</th>
          {#if prefs.columns.power}<th class="col-power">{i18n.t('widgets.temperature.power')}</th>{/if}
          {#if prefs.columns.rate}<th class="col-rate">{i18n.t('widgets.temperature.rate')}</th>{/if}
          {#if prefs.columns.current}<th class="col-current">{i18n.t('widgets.temperature.current')}</th>{/if}
          {#if prefs.columns.target}<th class="col-target">{i18n.t('widgets.temperature.target')}</th>{/if}
          {#if prefs.columns.hold}<th class="col-hold" title={i18n.t('widgets.temperature.holdHint')}>{i18n.t('widgets.temperature.heaterTime')}</th>{/if}
        </tr>
      </thead>

      <tbody>
        {#each temp.sensors as s (s.name)}
          <tr>
            <td>
              <button
                class="sensor-name"
                class:dim={!s.chartVisible}
                onclick={() => toggleChart(s.name)}
                title={i18n.t('widgets.temperature.toggleSeries')}
              >
                <span class="icon-wrap" style="color: {s.color}">
                  <TempKindIcon
                    kind={s.kind}
                    speed={s.kind === 'fan' ? s.power : null}
                    size={20}
                  />
                </span>
                <span class="label">{s.displayName}</span>
              </button>
            </td>

            {#if prefs.columns.power}
              <td class="col-power">
                {#if s.kind !== 'sensor'}
                  <button
                    class="power-btn"
                    class:active={s.powerVisible}
                    onclick={() => togglePower(s.name)}
                    title={i18n.t('widgets.temperature.togglePower')}
                  >
                    {fmtPower(s.power, offLabel)}
                  </button>
                {/if}
              </td>
            {/if}

            {#if prefs.columns.rate}<td class="col-rate">{fmtRate(s.rate)}</td>{/if}
            {#if prefs.columns.current}<td class="col-current">{fmtTemp(s.temperature)}</td>{/if}

            {#if prefs.columns.target}
              <td class="col-target">
                {#if s.kind !== 'sensor'}
                  <TargetInput value={s.target} onCommit={(v) => setTarget(s.name, v)} />
                {/if}
              </td>
            {/if}

            {#if prefs.columns.hold}
              <td class="col-hold">
                {#if s.kind === 'heater'}
                  {@const st = temp.holdStatus(s.name)}
                  <HoldInput
                    value={temp.holdMinutes[s.name] ?? 0}
                    phase={st.phase}
                    remainingMs={st.remainingMs}
                    onCommit={(m) => temp.setHoldMinutes(s.name, m)}
                  />
                {/if}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
    </div>
  {/if}

  <div class="chart-slot">
    <TemperatureChart
      sensors={temp.sensors}
      buffers={temp.buffers}
      tick={temp.tick}
    />
  </div>
</div>

<style>
  .temp-widget {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    height: 100%;
    min-height: 0;
    /* много датчиков + график выше виджета: прокручиваем, а не режем график */
    overflow-y: auto;
    overflow-x: hidden;
  }

  .notice {
    color: var(--text-muted);
    font-style: italic;
    padding: var(--space-md);
    text-align: center;
  }

  .temp-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: var(--font-size-md);
  }

  .w-power { width: 120px; }
  .w-rate { width: 120px; }
  .w-current { width: 120px; }
  .w-target { width: 120px; }
  .w-hold { width: 130px; }

  .temp-table th {
    text-align: center;
    color: var(--text-muted);
    font-weight: 600;
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .temp-table td {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .temp-table th:first-child,
  .temp-table td:first-child {
    text-align: start;
  }

  .col-power,
  .col-rate,
  .col-current,
  .col-target,
  .col-hold {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* числа с «°C», «+», «%» не должны переставляться знаками в RTL */
  td.col-power,
  td.col-rate,
  td.col-current {
    direction: ltr;
    unicode-bidi: isolate;
  }

  td.col-current {
    font-size: var(--font-size-lg);
    font-weight: 600;
  }

  td.col-rate {
    color: var(--text-secondary);
  }

  .sensor-name {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-md);
    font-weight: 500;
    cursor: pointer;
    padding: 2px 0;
    max-width: 100%;
    overflow: hidden;
  }

  .sensor-name.dim {
    opacity: 0.45;
    text-decoration: line-through;
  }

  .sensor-name .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .power-btn {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    padding: 2px var(--space-xs);
    border-radius: var(--radius-sm);
  }

  .power-btn:hover {
    background: var(--bg-surface-hover);
  }

  .power-btn.active {
    color: var(--accent);
    background: var(--bg-surface-active);
  }

  /* Высота графика берётся от слота, а не слот от графика: uPlot держит размер в пикселях, и при
     базе `auto` слот «запоминал» высоту, полученную в другом режиме (карточки → таблица), и
     выдавливал таблицу. Минимум равен минимуму самого графика; при нехватке места виджет
     прокручивается. */
  .chart-slot {
    flex: 1 1 0;
    min-height: clamp(220px, 45dvh, 400px);
  }

  /* принудительная «Таблица» в узком виджете: таблица держит нужную ширину, виджет скроллится вбок */
  .table-wrap {
    overflow-x: auto;
    /* overflow ≠ visible делает flex-элемент сжимаемым до 0 — таблица не должна уступать графику */
    flex-shrink: 0;
  }

  /* ---------- карточки датчиков (как чипы быстрого доступа) ---------- */

  .sensor-cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-xs);
  }

  .sensor-card {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2px;
    width: 100%;
    min-height: 56px;
    padding-block: 4px 6px;
    padding-inline: 12px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    text-align: start;
    cursor: pointer;
    overflow: hidden;
    transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .sensor-card::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: 3px;
    background: var(--sensor-color, var(--accent));
  }

  .sensor-card:hover {
    box-shadow: var(--shadow-sm);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  }

  .sensor-card.open { background: var(--bg-surface-active); border-color: var(--accent); }
  .sensor-card.dim { opacity: 0.55; }

  .card-name {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-width: 0;
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
  }

  .card-name .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-value {
    display: flex;
    align-items: baseline;
    gap: 6px;
    /* числа с «°C», «%» не переставляются знаками в RTL */
    direction: ltr;
    unicode-bidi: isolate;
    font-variant-numeric: tabular-nums;
  }

  .card-main { font-size: var(--font-size-lg); font-weight: 700; }
  .card-sub { font-size: var(--font-size-sm); color: var(--text-muted); }
</style>