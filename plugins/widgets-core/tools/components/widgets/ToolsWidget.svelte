<script lang="ts">
  import { onDestroy } from 'svelte';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../shared/icons/Icon.svelte';

  import { cleanCarriage } from '../../use-toolhead.svelte.ts';

  import KlipperNotReady from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { useToolhead, DEFAULT_STEPS } from '../../use-toolhead.svelte.ts';
  import { isRtl } from '../../../../shared/popover-align';

  import SliderField from '../../../../shared/slider-field/SliderField.svelte';

  import '../../../../shared/input/inputs.css';

  const api = useWidget();
  const i18n = useI18n();
  const store = useToolhead(api);

  const klippy = useKlippyState(api);

  // ---------------- режимы dual_carriage ----------------
  let modeMenu = $state<{ carriage: string; pos: { top: number; left: number } } | null>(null);

  function dcPrinting(): boolean {
    return store.th.printState === 'printing' || store.th.printState === 'paused';
  }

  function openModeMenu(e: MouseEvent, carriage: string): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = 160;
    const extra = store.ui.directMode && carriage === store.dualCarriageName() ? 1 : 0;
    const h = 34 + (store.modesFor(carriage).length + extra) * 30;
    const preferred = isRtl() ? r.right - w : r.left;
    const left = Math.max(8, Math.min(preferred, window.innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    modeMenu = { carriage, pos: { top, left } };
  }

  // ---------------- spool tooltip ----------------
  let spoolTip = $state<{ tool: string; spoolId: number; x: number; y: number; above: boolean } | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const HOVER_DELAY = 400;
  const PRESS_DELAY = 500;

  function positionTip(el: HTMLElement): { x: number; y: number; above: boolean } {
    const r = el.getBoundingClientRect();
    const tipW = 220;
    let x = r.left + r.width / 2 - tipW / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - tipW - 8));
    const above = r.top > 160;
    const y = above ? r.top - 8 : r.bottom + 8;
    return { x, y, above };
  }

  async function showTip(el: HTMLElement, tool: string, spoolId: number): Promise<void> {
    const pos = positionTip(el);
    spoolTip = { tool, spoolId, ...pos };
    await store.refreshSpool(spoolId);
  }

  function hideTip(): void { spoolTip = null; }

  function onChipHoverStart(e: PointerEvent, tool: string, spoolId: number | null): void {
    if (spoolId == null || e.pointerType !== 'mouse') return;
    const el = e.currentTarget as HTMLElement;
    hoverTimer = setTimeout(() => void showTip(el, tool, spoolId), HOVER_DELAY);
  }
  function onChipHoverEnd(): void {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (spoolTip) hideTip();
  }
  function onChipPressStart(e: PointerEvent, tool: string, spoolId: number | null): void {
    if (spoolId == null || e.pointerType === 'mouse') return;
    const el = e.currentTarget as HTMLElement;
    pressTimer = setTimeout(() => void showTip(el, tool, spoolId), PRESS_DELAY);
  }
  function onChipPressEnd(): void {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }

  let style = $derived(store.ui.style);
  let steps = $derived(store.ui.steps);

  let fmSteps = $derived([...steps].sort((a, b) => a - b).slice(0, 3));
  let fmStepsDesc = $derived([...fmSteps].reverse());

  let stepIdx = $state(2);
  let step = $derived(steps[Math.min(stepIdx, steps.length - 1)] ?? 10);

  let activeTool = $derived(store.activeTool);

  let paVal = $derived(
    store.th.pa[store.th.activeExtruder] ?? { advance: 0, smooth: 0.04 },
  );
  let paDef = $derived(
    store.meta.defaults.pa[store.th.activeExtruder] ?? { advance: 0, smooth: 0.04 },
  );

  function clickTool(tool: string): void {
    store.runTool(tool);
  }
  const AXES = ['X', 'Y', 'Z'] as const;

  function jogDisabled(axis: string): boolean {
    return store.forceMove || !store.homed(axis);
  }

  function fmt(s: number): string {
    return String(s);
  }

  let speedView = $derived(Math.round(store.th.speedFactor * 100));
  let flowView = $derived(Math.round(store.th.extrudeFactor * 100));

  let extLen = $state(Number(api.settings.get<number>('tools.extrudeLen') ?? 10));
  let extSpeed = $state(Number(api.settings.get<number>('tools.extrudeSpeed') ?? 5));

  const offPrinterExt = api.onPrinterChange(() => {
    extLen = Number(api.settings.get<number>('tools.extrudeLen') ?? 10);
    extSpeed = Number(api.settings.get<number>('tools.extrudeSpeed') ?? 5);
  });

  onDestroy(() => {
    offPrinterExt();
    if (hoverTimer) clearTimeout(hoverTimer);
    if (pressTimer) clearTimeout(pressTimer);
  });

  function setExt(key: 'tools.extrudeLen' | 'tools.extrudeSpeed', raw: string, set: (n: number) => void): void {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    set(n);
    api.settings.set(key, n);
  }

  function canType(axis: string): boolean {
    return store.th.printState === 'standby' && store.homed(axis);
  }

  function canTypeDirect(): boolean {
    return store.th.printState === 'standby' && store.directHomed;
  }

  function jogDirectDisabled(): boolean {
    return store.forceMove || !store.directHomed;
  }

  let directActive = $derived(store.isDirectActive);

  let duX = $derived(directActive && store.meta.directPrimaryAxis === 'x');
  let duY = $derived(directActive && store.meta.directPrimaryAxis === 'y');

  onDestroy(() => {
    if (hoverTimer) clearTimeout(hoverTimer);
    if (pressTimer) clearTimeout(pressTimer);
  });
</script>

{#if !klippy.ready}
  <KlipperNotReady />
{:else}
  <div class="tools">
    <!-- Тулы -->
    {#if store.meta.tools.length > 0}
      <div class="row chips">
        {#each store.meta.tools as tool (tool)}
          {@const sid = store.spoolIdForTool(tool)}
          {@const color = store.spoolColorForTool(tool)}
          <button
            class="chip"
            class:active={activeTool === tool}
            onclick={() => clickTool(tool)}
            onpointerenter={(e) => onChipHoverStart(e, tool, sid)}
            onpointerleave={onChipHoverEnd}
            onpointerdown={(e) => onChipPressStart(e, tool, sid)}
            onpointerup={onChipPressEnd}
            onpointercancel={onChipPressEnd}
          >
            {#if color}
              <svg class="spool-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <circle cx="8" cy="8" r="7" fill={color} stroke="rgba(0,0,0,.25)" stroke-width="0.7"></circle>
                <circle cx="8" cy="8" r="2.8" fill="var(--bg-surface)"></circle>
              </svg>
            {/if}
            {tool}
          </button>
        {/each}
      </div>
    {/if}

    <!-- dual_carriage: статус + смена режима -->
    {#if store.meta.hasDualCarriage}
      <div class="row chips">
        {#each Object.entries(store.th.dcModes) as [name, mode] (name)}
          <button
            class="chip"
            class:active={mode !== 'INACTIVE'}
            disabled={dcPrinting()}
            title={dcPrinting()
              ? i18n.t('widgets.tools.dcBlockedPrint')
              : i18n.t('widgets.tools.dcMode')}
            onclick={(e) => openModeMenu(e, name)}
          >
            {cleanCarriage(name)}: {mode}
            <Icon name="chevron-down" size={12} />
          </button>
        {/each}
      </div>
    {/if}

    {#if store.forceMove}
      <div class="fm-note">{i18n.t('widgets.tools.forceMoveNote')}</div>

      <div class="rows">
        {#each store.meta.steppers as st (st)}
          <div class="axis-row">
            {#each fmStepsDesc as s (s)}
              <button class="btn rsq" onclick={() => store.forceMoveStepper(st, -s)}>
                −{fmt(s)}
              </button>
            {/each}

            <bdi class="fm-name" title={st}>{st}</bdi>

            {#each fmSteps as s (s)}
              <button class="btn rsq" onclick={() => store.forceMoveStepper(st, s)}>
                +{fmt(s)}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    {:else if style === 'cross'}
      <div class="move-area">
        <!-- Единый grid: XY-крест + Z-колонка -->
        <div class="cross" class:du-x={duX} class:du-y={duY}>
          <button class="btn sq a-yup" disabled={jogDisabled('Y')} onclick={() => store.jog('Y', step)}>
            <Icon name="chevron-up" size={16} />
          </button>
          <button class="btn sq a-xmin" disabled={jogDisabled('X')} onclick={() => store.jog('X', -step)}>
            <Icon name="chevron-left" size={16} />
          </button>
          <span class="pad-label a-lab">XY</span>
          <button class="btn sq a-xmax" disabled={jogDisabled('X')} onclick={() => store.jog('X', step)}>
            <Icon name="chevron-right" size={16} />
          </button>
          <button class="btn sq a-ymin" disabled={jogDisabled('Y')} onclick={() => store.jog('Y', -step)}>
            <Icon name="chevron-down" size={16} />
          </button>

          <!-- Z-колонка -->
          <button class="btn sq a-zup" disabled={jogDisabled('Z')} onclick={() => store.jog('Z', step)}>
            <Icon name="chevron-up" size={16} />
          </button>
          <span class="pad-label a-zlab">Z</span>
          <button class="btn sq a-zmin" disabled={jogDisabled('Z')} onclick={() => store.jog('Z', -step)}>
            <Icon name="chevron-down" size={16} />
          </button>

          {#if duX}
            <button class="btn sq du a-umin" disabled={jogDirectDisabled()} onclick={() => store.jogDirect(-step)}>
              <Icon name="chevron-left" size={16} />
            </button>
            <span class="pad-label accent a-ulab">{store.ui.directAxis}</span>
            <button class="btn sq du a-umax" disabled={jogDirectDisabled()} onclick={() => store.jogDirect(step)}>
              <Icon name="chevron-right" size={16} />
            </button>
          {/if}

          {#if duY}
            <button class="btn sq du a-umax" disabled={jogDirectDisabled()} onclick={() => store.jogDirect(step)}>
              <Icon name="chevron-up" size={16} />
            </button>
            <span class="pad-label accent a-ulab">{store.ui.directAxis}</span>
            <button class="btn sq du a-umin" disabled={jogDirectDisabled()} onclick={() => store.jogDirect(-step)}>
              <Icon name="chevron-down" size={16} />
            </button>
          {/if}
        </div>

        <div class="home-col">
          <div class="home-row wide">
            <button class="btn rsq home all" title="{i18n.t('widgets.tools.home')} {i18n.t('widgets.tools.homeall')}" onclick={() => store.homeAll()}>
              <Icon name="home" size={14} />
              <span class="home-label">{i18n.t('widgets.tools.homeAll')}</span>
            </button>
            <button
              class="btn rsq home all"
              title="{i18n.t('widgets.tools.home')} XY"
              onclick={() => store.homeAxes('X Y')}
            >
              <Icon name="home" size={14} />
              <span class="home-label">XY</span>
            </button>
          </div>

          <div class="home-row axes">
            <button class="btn rsq home" title="{i18n.t('widgets.tools.home')} X" onclick={() => store.homeAxes('X')}>
              <Icon name="home" size={14} />
              <span class="home-label">X</span>
            </button>
            <button class="btn rsq home" title="{i18n.t('widgets.tools.home')} Y" onclick={() => store.homeAxes('Y')}>
              <Icon name="home" size={14} />
              <span class="home-label">Y</span>
            </button>
            <button class="btn rsq home" title="{i18n.t('widgets.tools.home')} Z" onclick={() => store.homeAxes('Z')}>
              <Icon name="home" size={14} />
              <span class="home-label">Z</span>
            </button>
          </div>

          {#if !store.forceMove && (store.hasQgl || store.hasZTilt)}
            <div class="home-row calibration">
              {#if store.hasQgl}
                <button
                  class="btn rsq calib"
                  onclick={() => store.qgl()}
                  title={i18n.t('widgets.tools.qglHint')}
                >
                  {i18n.t('widgets.tools.qgl')}
                </button>
              {/if}
              {#if store.hasZTilt}
                <button
                  class="btn rsq calib"
                  onclick={() => store.zTiltAdjust()}
                  title={i18n.t('widgets.tools.zTiltHint')}
                >
                  {i18n.t('widgets.tools.zTilt')}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <div class="row chips steps">
        {#each steps as s, i (i)}
          <button class="chip" class:active={stepIdx === i} onclick={() => (stepIdx = i)}>
            {fmt(s)}
          </button>
        {/each}
      </div>
    {:else}
      <!-- строки: [−steps] [положение] [+steps]; парковки — тем же блоком, что в кресте -->
      <div class="rows">
        {#each AXES as axis, i (axis)}
          <div class="axis-row">
            {#each [...steps].reverse() as s (s)}
              <button class="btn rsq" disabled={jogDisabled(axis)} onclick={() => store.jog(axis, -s, false)}>
                −{fmt(s)}
              </button>
            {/each}

            <div class="mpu-field pos-field row-pos">
              <span class="mpu-field-legend">
                {axis} [ {(store.th.position[i] ?? 0).toFixed(2)} ]
              </span>
              {#if canType(axis)}
                <input
                  class="mpu-input"
                  type="number"
                  step="any"
                  placeholder={(store.th.gcodePosition[i] ?? 0).toFixed(axis === 'Z' ? 3 : 2)}
                  onkeydown={(e) => {
                    if (e.key !== 'Enter') return;
                    const v = Number(e.currentTarget.value);
                    if (Number.isFinite(v)) {
                      store.moveTo(axis, v);
                      e.currentTarget.value = '';
                      e.currentTarget.blur();
                    }
                  }}
                />
              {:else}
                <span class="mpu-field-value">
                  {(store.th.gcodePosition[i] ?? 0).toFixed(axis === 'Z' ? 3 : 2)}
                </span>
              {/if}
            </div>

            {#each steps as s (s)}
              <button class="btn rsq" disabled={jogDisabled(axis)} onclick={() => store.jog(axis, s, false)}>
                +{fmt(s)}
              </button>
            {/each}
          </div>
        {/each}

        {#if directActive}
          <div class="axis-row">
            {#each [...steps].reverse() as s (s)}
              <button class="btn rsq dir" disabled={jogDirectDisabled()} onclick={() => store.jogDirect(-s)}>
                −{fmt(s)}
              </button>
            {/each}

            <div class="mpu-field pos-field row-pos">
              <span class="mpu-field-legend">
                {store.ui.directAxis} [ {(store.th.position[4] ?? 0).toFixed(2)} ]
              </span>
              {#if canTypeDirect()}
                <input
                  class="mpu-input"
                  type="number"
                  step="any"
                  placeholder={(store.th.gcodePosition[4] ?? 0).toFixed(2)}
                  onkeydown={(e) => {
                    if (e.key !== 'Enter') return;
                    const v = Number(e.currentTarget.value);
                    if (Number.isFinite(v)) {
                      store.moveToDirect(v);
                      e.currentTarget.value = '';
                      e.currentTarget.blur();
                    }
                  }}
                />
              {:else}
                <span class="mpu-field-value">
                  {(store.th.gcodePosition[4] ?? 0).toFixed(2)}
                </span>
              {/if}
            </div>

            {#each steps as s (s)}
              <button class="btn rsq dir" disabled={jogDirectDisabled()} onclick={() => store.jogDirect(s)}>
                +{fmt(s)}
              </button>
            {/each}
          </div>
        {/if}

        <!-- парковки + калибровка: в rows-режиме калибровка СПРАВА от парковок,
             колонкой в высоту двух home-рядов (не занимает вертикаль) -->
        <div class="home-area">
          <div class="home-col rows-home">
            <div class="home-row wide">
              <button class="btn rsq home all" title={i18n.t('widgets.tools.homeAll')} onclick={() => store.homeAll()}>
                <Icon name="home" size={14} />
              </button>
              <button
                class="btn rsq home all"
                title="{i18n.t('widgets.tools.home')} XY"
                onclick={() => store.homeAxes('X Y')}
              >
                <Icon name="home" size={12} />
                <span class="home-label">XY</span>
              </button>
            </div>
            <div class="home-row axes">
              <button class="btn rsq home" title="{i18n.t('widgets.tools.home')} X" onclick={() => store.homeAxes('X')}>
                <span class="home-label">X</span>
              </button>
              <button class="btn rsq home" title="{i18n.t('widgets.tools.home')} Y" onclick={() => store.homeAxes('Y')}>
                <span class="home-label">Y</span>
              </button>
              <button class="btn rsq home" title="{i18n.t('widgets.tools.home')} Z" onclick={() => store.homeAxes('Z')}>
                <span class="home-label">Z</span>
              </button>
            </div>
          </div>

          {#if !store.forceMove && (store.hasQgl || store.hasZTilt)}
            <div class="calib-col">
              {#if store.hasQgl}
                <button
                  class="btn rsq calib"
                  onclick={() => store.qgl()}
                  title={i18n.t('widgets.tools.qglHint')}
                >
                  QGL
                </button>
              {/if}
              {#if store.hasZTilt}
                <button
                  class="btn rsq calib"
                  onclick={() => store.zTiltAdjust()}
                  title={i18n.t('widgets.tools.zTiltHint')}
                >
                  Z-TILT
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if !store.forceMove && style === 'cross'}
      <!-- положение: в строковом режиме встроено в строки осей -->
      <div class="pos-row">
        {#each AXES as axis, i (axis)}
          <div class="mpu-field pos-field">
            <span class="mpu-field-legend">
              {axis} [ {(store.th.position[i] ?? 0).toFixed(2)} ]
            </span>
            {#if canType(axis)}
              <input
                class="mpu-input"
                type="number"
                step="any"
                placeholder={(store.th.gcodePosition[i] ?? 0).toFixed(axis === 'Z' ? 3 : 2)}
                onkeydown={(e) => {
                  if (e.key !== 'Enter') return;
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v)) {
                    store.moveTo(axis, v);
                    e.currentTarget.value = '';
                    e.currentTarget.blur();
                  }
                }}
              />
            {:else}
              <span class="mpu-field-value">
                {(store.th.gcodePosition[i] ?? 0).toFixed(axis === 'Z' ? 3 : 2)}
              </span>
            {/if}
          </div>
        {/each}

        {#if directActive}
          <div class="mpu-field pos-field">
            <span class="mpu-field-legend">
              {store.ui.directAxis} [ {(store.th.position[4] ?? 0).toFixed(2)} ]
            </span>
            {#if canTypeDirect()}
              <input
                class="mpu-input"
                type="number"
                step="any"
                placeholder={(store.th.gcodePosition[4] ?? 0).toFixed(2)}
                onkeydown={(e) => {
                  if (e.key !== 'Enter') return;
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v)) {
                    store.moveToDirect(v);
                    e.currentTarget.value = '';
                    e.currentTarget.blur();
                  }
                }}
              />
            {:else}
              <span class="mpu-field-value">
                {(store.th.gcodePosition[4] ?? 0).toFixed(2)}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Extruder -->
    <div class="ret-title">{i18n.t('widgets.tools.extrude')}</div>
    {#if store.meta.extruders.length > 0}
      <div class="ext">
        {#if store.meta.extruders.length > 1}
          <div class="row chips">
            {#each store.meta.extruders as e (e)}
              <button
                class="chip"
                class:active={store.th.activeExtruder === e}
                onclick={() => store.activateExtruder(e)}
              >
                {e}
              </button>
            {/each}
          </div>
        {/if}

        <div class="ext-grid">
          <label class="mpu-field">
            <span class="mpu-field-legend">{i18n.t('widgets.tools.extrudeLen')}</span>
            <input
              class="mpu-input"
              type="number"
              min="0.1"
              step="any"
              value={extLen}
              onchange={(e) => setExt('tools.extrudeLen', e.currentTarget.value, (n) => (extLen = n))}
            />
            <span class="mpu-field-unit">mm</span>
          </label>

          <button
            class="btn ext-btn"
            disabled={store.coldBlocked()}
            title={store.coldBlocked() ? i18n.t('widgets.tools.cold') : ''}
            onclick={() => store.extrude(-1)}
          >
            {i18n.t('widgets.tools.retract')}
            <Icon name="chevron-up" size={14} />
          </button>

          <label class="mpu-field">
            <span class="mpu-field-legend">{i18n.t('widgets.tools.extrudeSpeed')}</span>
            <input
              class="mpu-input"
              type="number"
              min="0.1"
              step="any"
              value={extSpeed}
              onchange={(e) => setExt('tools.extrudeSpeed', e.currentTarget.value, (n) => (extSpeed = n))}
            />
            <span class="mpu-field-unit">mm/s</span>
          </label>

          <button
            class="btn ext-btn"
            disabled={store.coldBlocked()}
            title={store.coldBlocked() ? i18n.t('widgets.tools.cold') : ''}
            onclick={() => store.extrude(1)}
          >
            {i18n.t('widgets.tools.extrude')}
            <Icon name="chevron-down" size={14} />
          </button>
        </div>
      </div>
    {/if}

    <!-- Speed / Flow -->
    <div class="ret-title">{i18n.t('widgets.tools.speed-flow')}</div>
    <div class="sf-grid">
      <SliderField
        label={i18n.t('widgets.tools.speed')}
        value={speedView} min={1} max={200} step={1} unit="%"
        onCommit={(v) => store.setSpeed(v)}
        onReset={() => store.setSpeed(100)}
      />
      <SliderField
        label={i18n.t('widgets.tools.flow')}
        value={flowView} min={1} max={200} step={1} unit="%"
        onCommit={(v) => store.setFlow(v)}
        onReset={() => store.setFlow(100)}
      />
    </div>

    <!-- PA -->
    <div class="ret-title">{i18n.t('widgets.tools.pa')}</div>
    <div class="sf-grid">
      <SliderField
        label={i18n.t('widgets.tools.pa')}
        value={paVal.advance} min={0} max={2} step={0.001} unit="s" decimals={3}
        onCommit={(v) => store.setPA({ advance: v })}
        onReset={() => store.setPA({ advance: paDef.advance })}
      />
      <SliderField
        label={i18n.t('widgets.tools.paSmooth')}
        value={paVal.smooth} min={0} max={0.2} step={0.001} unit="s" decimals={3}
        onCommit={(v) => store.setPA({ smooth: v })}
        onReset={() => store.setPA({ smooth: paDef.smooth })}
      />
    </div>

    <!-- Retracts only if [firmware_retraction] -->
    {#if store.meta.hasRetraction}
      <div class="ret-title">{i18n.t('widgets.tools.retraction')}</div>
      <div class="sf-grid">
        <SliderField
          label={i18n.t('widgets.tools.retractLength')}
          value={store.th.retraction.length} min={0} max={5} step={0.05} unit="mm" decimals={2}
          onCommit={(v) => store.setRetraction({ length: v })}
          onReset={() => store.setRetraction({ length: store.meta.defaults.retraction.length })}
        />
        <SliderField
          label={i18n.t('widgets.tools.retractSpeed')}
          value={store.th.retraction.speed} min={1} max={100} step={1} unit="mm/s"
          onCommit={(v) => store.setRetraction({ speed: v })}
          onReset={() => store.setRetraction({ speed: store.meta.defaults.retraction.speed })}
        />
        <SliderField
          label={i18n.t('widgets.tools.unretractExtra')}
          value={store.th.retraction.extra} min={0} max={5} step={0.05} unit="mm" decimals={2}
          onCommit={(v) => store.setRetraction({ extra: v })}
          onReset={() => store.setRetraction({ extra: store.meta.defaults.retraction.extra })}
        />
        <SliderField
          label={i18n.t('widgets.tools.unretractSpeed')}
          value={store.th.retraction.unspeed} min={1} max={100} step={1} unit="mm/s"
          onCommit={(v) => store.setRetraction({ unspeed: v })}
          onReset={() => store.setRetraction({ unspeed: store.meta.defaults.retraction.unspeed })}
        />
      </div>
    {/if}
  </div>

  {#if modeMenu}
    <div class="menu-backdrop" onclick={() => (modeMenu = null)} role="presentation"></div>

    <div
      class="dc-menu"
      style:top="{modeMenu.pos.top}px"
      style:left="{modeMenu.pos.left}px"
      role="menu"
    >
      <div class="dc-menu-title">{i18n.t('widgets.tools.dcMode')}</div>

      {#each store.modesFor(modeMenu.carriage) as m (m)}
        {@const current = (store.th.dcModes[modeMenu.carriage] ?? '').toUpperCase()}
        <button
          class="dc-item"
          class:checked={current === m}
          onclick={() => {
            store.setCarriageMode(modeMenu.carriage, m);
            modeMenu = null;
          }}
        >
          <span class="check">{current === m ? '✓' : ''}</span>
          {m}
        </button>
      {/each}

      {#if store.ui.directMode && modeMenu.carriage === store.dualCarriageName()}
        {@const current = (store.th.dcModes[modeMenu.carriage] ?? '').toUpperCase()}
        <div class="dc-sep"></div>
        <button
          class="dc-item direct"
          class:checked={current === 'DIRECT'}
          onclick={() => {
            store.setCarriageDirect(modeMenu.carriage, true);
            modeMenu = null;
          }}
        >
          <span class="check">{current === 'DIRECT' ? '✓' : ''}</span>
          DIRECT
        </button>
      {/if}
    </div>
  {/if}

  <!-- Spool tooltip -->
  {#if spoolTip}
    {@const spool = store.getSpool(spoolTip.spoolId)}
    {#if spool}
      <div
        class="spool-tip"
        class:above={spoolTip.above}
        style:left="{spoolTip.x}px"
        style:top="{spoolTip.y}px"
        role="tooltip"
        onpointerleave={hideTip}
      >
        <div class="spool-tip-head">
          <span
            class="spool-swatch"
            style:background={spool.filament.color_hex ? `#${spool.filament.color_hex}` : 'var(--text-muted)'}
          ></span>
          <span class="spool-name">{spool.filament.name ?? `#${spool.id}`}</span>
        </div>
        {#if spool.filament.vendor?.name}
          <div class="spool-row">{spool.filament.vendor.name}</div>
        {/if}
        {#if spool.filament.material}
          <span class="spool-mat">{spool.filament.material}</span>
        {/if}
        {#if spool.remaining_weight != null && spool.filament.weight}
          {@const pct = Math.max(0, Math.min(100, Math.round((spool.remaining_weight / spool.filament.weight) * 100)))}
          <div class="spool-bar-track">
            <div class="spool-bar-fill" style:width="{pct}%"></div>
          </div>
          <div class="spool-row">{Math.round(spool.remaining_weight)} г · {pct}%</div>
        {/if}
      </div>
    {/if}
  {/if}
{/if}

<style>
  :global(mpu-widgets-tools) {
    display: block;
    height: 100%;
  }

  .mpu-field {
    min-width: 100px;
  }

  .axis-row {
    direction: ltr; /* −шаги слева, +шаги справа: оси не зеркалятся в RTL */
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: nowrap;
  }

  .tools {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    height: 100%;
    overflow-y: auto;
    min-height: 0;
    padding: var(--space-xs);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .chips {
    flex-wrap: wrap;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-family: monospace;
    cursor: pointer;
  }

  .chip:hover {
    background: var(--bg-surface-hover);
  }

  .chip.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-surface-active);
  }

  .spool-icon {
    flex-shrink: 0;
    vertical-align: middle;
  }

  .fm-note {
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: 12px;
  }

  .move-area {
    display: flex;
    gap: var(--space-sm);
    align-items: flex-start;
  }

  /* -------- единый grid: XY + Z -------- */
  .cross {
    direction: ltr; /* X− слева, X+ справа независимо от языка интерфейса */
    display: grid;
    gap: var(--space-xs);
    grid-template-columns: repeat(4, 44px);
    grid-template-rows: repeat(3, 44px);
    grid-template-areas:
      '.    yup  .    zup'
      'xmin lab  xmax zlab'
      '.    ymin .    zmin';
  }

  /* X-IDEX: строка U под строкой X */
  .cross.du-x {
    grid-template-rows: repeat(4, 44px);
    grid-template-areas:
      '.    yup  .    zup'
      'xmin lab  xmax zlab'
      'umin ulab umax zmin'
      '.    ymin .    .';
  }

  /* Y-IDEX: колонка U справа от Y, перед Z */
  .cross.du-y {
    grid-template-columns: repeat(5, 44px);
    grid-template-areas:
      '.    yup  umax .    zup'
      'xmin lab  ulab xmax zlab'
      '.    ymin umin .    zmin';
  }

  .a-yup  { grid-area: yup; }
  .a-xmin { grid-area: xmin; }
  .a-lab  { grid-area: lab; }
  .a-xmax { grid-area: xmax; }
  .a-ymin { grid-area: ymin; }
  .a-zup  { grid-area: zup; }
  .a-zlab { grid-area: zlab; }
  .a-zmin { grid-area: zmin; }
  .a-umin { grid-area: umin; }
  .a-ulab { grid-area: ulab; }
  .a-umax { grid-area: umax; }

  .pad-label {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-secondary);
    user-select: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);

  }

  .pad-label.accent {
    color: var(--accent);
  }

  .home-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    width: max-content;
  }

  .home-row {
    display: flex;
    gap: var(--space-xs);
  }

  .home-row.axes .btn {
    flex: 1 1 0;
    min-width: 0;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn.sq {
    width: 44px;
    height: 44px;
    padding: 0;
    flex-shrink: 0;
  }

  .btn.sq.du {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    color: var(--accent);
  }

  .btn.rsq {
    width: 44px;
    height: 44px;
    padding: 0;
    flex-shrink: 0;
    font-size: var(--font-size-sm);
    font-family: monospace;
    margin-top: 8px
  }

  .btn.home {
    border-color: color-mix(in srgb, var(--warning) 60%, transparent);
    color: var(--warning);
    margin-top: 0px;
  }

  .btn.rsq.home.all {
    width: 80px;
    padding: var(--space-sm);
  }

  .btn.rsq.calib {
    flex: 1 1 0;
    min-width: 0;
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    color: var(--accent);
    font-size: var(--font-size-sm);
    font-weight: 600;
    margin-top: 0;
  }
  .btn.rsq.calib:hover {
    background: var(--bg-surface-active);
    border-color: var(--accent);
  }

  .home-label {
    font-size: var(--font-size-sm);
    font-weight: 700;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .rows-home {
    align-self: center;
  }

    /* rows-режим: колонка калибровки справа от парковок */
  .home-area {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    align-self: center;
  }

  .calib-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  /* компактные кнопки колонки: высота как у home-ряда (44px),
     ширина по контенту; сброс margin-top от .btn.rsq и flex от cross-правила */
  .calib-col .btn.rsq.calib {
    flex: none;
    width: auto;
    min-width: 44px;
    height: 44px;
    margin-top: 0;
    padding: 0 var(--space-xs);
    font-size: var(--font-size-sm);
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .axis-row {
    direction: ltr;
    display: flex;
    align-items: center;
    align-self: center;
    gap: 2px;
    flex-wrap: nowrap;
  }

  .steps {
    margin-top: var(--space-xs);
  }

  /* -------- DIRECT-ось -------- */

  .pos-row {
    display: flex;
    gap: var(--space-sm);
  }

  .pos-field {
    flex: 1;
  }

  .ext-grid {
    display: grid;
    grid-template-columns: 1fr 150px;
    gap: var(--space-sm);
    align-items: stretch;
  }

  .ext-btn {
    margin-top: 8px;
    justify-content: space-between;
  }

  .sf-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm) var(--space-md);
  }

  .ret-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin-top: var(--space-md);
  }

  .home-row {
    flex-wrap: wrap;
  }

  .fm-name {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-secondary);
    font-family: monospace;
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 1;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .dc-menu {
    position: fixed;
    z-index: 461;
    min-width: 150px;
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
  }

  .dc-menu-title {
    padding: var(--space-xs) var(--space-sm);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .dc-item {
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

  .dc-item:hover {
    background: var(--bg-surface-hover);
  }

  .dc-item.direct {
    color: var(--accent);
  }

  .dc-item .check {
    width: 14px;
    flex-shrink: 0;
    color: var(--accent);
    font-size: 12px;
  }

  .dc-sep {
    height: 1px;
    margin: var(--space-xs) 0;
    background: var(--border-color);
  }

  /* -------- spool tooltip -------- */
  .spool-tip {
    position: fixed;
    z-index: 470;
    width: 220px;
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: auto;
  }
  .spool-tip.above { transform: translateY(-100%); }

  .spool-tip-head { display: flex; align-items: center; gap: 6px; }
  .spool-swatch {
    width: 14px; height: 14px; border-radius: 50%;
    border: 1px solid rgba(0,0,0,.2); flex-shrink: 0;
  }
  .spool-name {
    font-size: var(--font-size-sm); font-weight: 600;
    color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .spool-row { font-size: 12px; color: var(--text-secondary); }
  .spool-mat {
    display: inline-block; padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-surface-hover);
    border: 1px solid var(--border-color);
    font-size: 11px; font-weight: 600;
    color: var(--text-secondary);
    width: fit-content;
  }
  .spool-bar-track {
    height: 4px; border-radius: 2px;
    background: var(--bg-surface-hover); overflow: hidden;
  }
  .spool-bar-fill {
    height: 100%; border-radius: 2px;
    background: var(--accent); transition: width 0.3s ease;
  }

</style>