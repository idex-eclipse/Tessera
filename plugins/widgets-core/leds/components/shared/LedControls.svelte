<script lang="ts">
  import '../../../../shared/input/inputs.css';
  import ColorPickerMenu from '../../../../shared/color-picker/ColorPickerMenu.svelte';
  import SliderField from '../../../../shared/slider-field/SliderField.svelte';
  import {
    OFF,
    brightnessOf,
    colorToCss,
    hexToRgbw,
    rgbwToHex,
    withBrightness,
    type LedItem,
    type Rgbw,
  } from '../../lib/led-data';
  import type { LedsStore } from '../../data/use-leds.svelte';

  let {
    store,
    item,
    selected = [],
    i18n,
    layer = 460,
    onDone = null,
  }: {
    store: LedsStore;
    item: LedItem;
    /** выбранные пиксели (0-based); пусто = вся цепочка */
    selected?: number[];
    i18n: { t: (key: string, params?: Record<string, string | number>) => string };
    /** z-слой меню цвета (внутри поповера чипа — выше поповера) */
    layer?: number;
    /** после коммит-действий (пресет, шаблон) — например, закрыть поповер */
    onDone?: (() => void) | null;
  } = $props();

  let indices = $derived(selected.length > 0 ? selected : null);
  let current = $derived<Rgbw>(store.colors[item.id]?.[selected[0] ?? 0] ?? OFF);
  let hex = $derived(brightnessOf(current) > 0.001 ? rgbwToHex(current) : null);

  const PRESETS: Array<{ key: string; color: (w: boolean) => Rgbw }> = [
    { key: 'off', color: () => OFF },
    { key: 'white', color: (w) => (w ? [0, 0, 0, 1] : [1, 1, 1, 0]) },
    { key: 'warm', color: () => [1, 0.55, 0.2, 0] },
    { key: 'red', color: () => [1, 0, 0, 0] },
    { key: 'green', color: () => [0, 1, 0, 0] },
    { key: 'blue', color: () => [0, 0, 1, 0] },
  ];

  function send(color: Rgbw): void {
    store.setColor(item.id, color, indices);
  }

  // ColorPickerMenu зовёт onPick на каждом движении мыши — отправляем с задержкой
  let pickTimer: ReturnType<typeof setTimeout> | null = null;
  function onPick(value: string | null): void {
    if (pickTimer) clearTimeout(pickTimer);
    pickTimer = setTimeout(() => {
      pickTimer = null;
      if (value === null) {
        send(OFF);
        return;
      }
      const c = hexToRgbw(value, item.hasWhite ? current[3] : 0);
      if (c) send(c);
    }, 150);
  }

  // --- шаблоны ---
  let assigned = $derived(store.assignedTemplate(item.id, indices));
  let tplName = $state('');
  let tplParams = $state<Record<string, string>>({});
  let tpl = $derived(store.templates.find((t) => t.name === tplName) ?? null);

  function chooseTemplate(name: string): void {
    tplName = name;
    tplParams = { ...(store.templates.find((t) => t.name === name)?.params ?? {}) };
  }

  function applyTemplate(): void {
    if (!tpl) return;
    store.setTemplate(item.id, tpl.name, tplParams, indices);
    onDone?.();
  }

  function clearTemplate(): void {
    store.setTemplate(item.id, null, {}, indices);
  }
</script>

<div class="controls">
  <div class="row presets" role="group" aria-label={i18n.t('widgets.leds.presets.title')}>
    {#each PRESETS as p (p.key)}
      {@const c = p.color(item.hasWhite)}
      <button
        class="preset"
        title={i18n.t(`widgets.leds.presets.${p.key}`)}
        onclick={() => {
          send(c);
          onDone?.();
        }}
      >
        <span class="dot" class:off={p.key === 'off'} style:--c={colorToCss(c)}></span>
      </button>
    {/each}
    <span class="spacer"></span>
    <ColorPickerMenu value={hex} {i18n} {layer} {onPick} />
  </div>

  <SliderField
    label={i18n.t('widgets.leds.brightness')}
    value={Math.round(brightnessOf(current) * 100)}
    min={0}
    max={100}
    step={1}
    unit="%"
    onCommit={(v) => send(withBrightness(current, v / 100, item.hasWhite))}
    onReset={() => send(OFF)}
  />

  {#if item.hasWhite}
    <SliderField
      label={i18n.t('widgets.leds.white')}
      value={Math.round(current[3] * 100)}
      min={0}
      max={100}
      step={1}
      unit="%"
      onCommit={(v) => send([current[0], current[1], current[2], v / 100])}
      onReset={() => send([current[0], current[1], current[2], 0])}
    />
  {/if}

  {#if store.visibleTemplates.length > 0 || assigned}
    <div class="tpl">
      <div class="tpl-head">
        <span class="tpl-title">{i18n.t('widgets.leds.template')}</span>
        {#if assigned}
          <span class="tpl-active" title={i18n.t('widgets.leds.templateFromUiNote')}>
            {i18n.t('widgets.leds.templateFromUi', { name: assigned })}
          </span>
        {/if}
      </div>

      <select
        class="mpu-input"
        value={tplName}
        onchange={(e) => chooseTemplate((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="">{i18n.t('widgets.leds.noTemplate')}</option>
        {#each store.visibleTemplates as t (t.name)}
          <option value={t.name}>{t.name}</option>
        {/each}
      </select>

      {#if tpl}
        {#each Object.keys(tplParams) as key (key)}
          <label class="param">
            <span class="param-name" dir="ltr">param_{key}</span>
            <input
              class="mpu-input"
              dir="ltr"
              spellcheck="false"
              value={tplParams[key]}
              oninput={(e) => (tplParams = { ...tplParams, [key]: (e.currentTarget as HTMLInputElement).value })}
            />
          </label>
        {/each}
      {/if}

      <div class="row">
        <button class="btn primary" disabled={!tpl} onclick={applyTemplate}>
          {i18n.t('widgets.leds.applyTemplate')}
        </button>
        <button class="btn" onclick={clearTemplate}>{i18n.t('widgets.leds.clearTemplate')}</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .spacer { flex: 1; }

  .preset {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    transition: background var(--transition-fast);
  }
  .preset:hover { background: var(--bg-surface-hover); }

  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--c);
    border: 1px solid var(--border-color);
  }
  .dot.off { background: var(--bg-surface); }

  .tpl {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding-top: var(--space-xs);
    border-top: 1px solid var(--border-color);
  }
  .tpl-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    min-width: 0;
  }
  .tpl-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .tpl-active {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
    color: var(--accent);
  }

  .param {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    align-items: center;
    gap: var(--space-xs);
  }
  .param-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  .btn {
    flex: 1;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover-no-override);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.primary {
    background: var(--accent-subtle-strong);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
</style>
