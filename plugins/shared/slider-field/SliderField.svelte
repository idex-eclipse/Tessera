<script lang="ts">
  import '../../shared/input/inputs.css';
  import { ExtensionPoint } from '../../../plugin-sdk/src/svelte/index';
  import type { MpuParams } from '../../../plugin-sdk/src/types';
  import Icon from '../icons/Icon.svelte';
  import { SLIDER_EVENTS, SLIDER_POINT_ID } from './extension-points';

  let {
    label,
    value,
    min,
    max,
    step,
    unit = '',
    decimals = 0,
    onCommit,
    onReset = null,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    decimals?: number;
    onCommit: (v: number) => void;
    onReset?: (() => void) | null;
  } = $props();

  let focused = $state(false);
  let dragging = $state(false);
  // Значение, отправленное командой, но ещё не подтверждённое дельтой.
  // Пока оно не совпало с пропом (или не истёк таймаут), внешняя
  // синхронизация НЕ перезаписывает draft — иначе на отпускании
  // цифра «прыгает» на старое значение до приезда дельты.
  let pendingCommit = $state<number | null>(null);
  let draft = $state(value.toFixed(decimals));

  $effect(() => {
    if (focused || dragging) return;

    if (pendingCommit != null) {
      if (Math.abs(value - pendingCommit) < 1e-6) {
        pendingCommit = null; // дельта подтвердила — разблокируем
      } else {
        return; // round-trip ещё идёт — draft не трогаем
      }
    }

    draft = value.toFixed(decimals);
  });

  function commitNumber(n: number): void {
    if (!Number.isFinite(n)) return;
    const v = Math.min(max, Math.max(min, n));
    pendingCommit = v;
    draft = v.toFixed(decimals);
    onCommit(v);

    // страховка: если дельта не придёт (offline/ошибка команды),
    // через 3с разблокируем и поле синхронизируется с реальным значением
    const sent = v;
    setTimeout(() => {
      if (pendingCommit === sent) pendingCommit = null;
    }, 3000);
  }

  function commitDraft(): void {
    commitNumber(Number(draft));
  }

  // What a replacing extension needs to draw the slider (params are strings by contract).
  let extParams = $derived<MpuParams>({
    label,
    value: String(value),
    min: String(min),
    max: String(max),
    step: String(step),
    unit,
    decimals: String(decimals),
    resettable: String(onReset != null),
  });

  // An extension cannot reach our state, so it reports back with bubbling composed events. The value
  // goes through commitNumber(): the clamping and the pending-value guard stay ours.
  let hostEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const el = hostEl;
    if (!el) return;
    const onExtCommit = (e: Event) => {
      const v = (e as CustomEvent<{ value?: unknown }>).detail?.value;
      if (typeof v === 'number') commitNumber(v);
    };
    const onExtReset = () => onReset?.();
    el.addEventListener(SLIDER_EVENTS.commit, onExtCommit);
    el.addEventListener(SLIDER_EVENTS.reset, onExtReset);
    return () => {
      el.removeEventListener(SLIDER_EVENTS.commit, onExtCommit);
      el.removeEventListener(SLIDER_EVENTS.reset, onExtReset);
    };
  });
</script>

<!-- display: contents keeps the grid cell the slider had; the host element only carries the listeners -->
<div class="sf-host" bind:this={hostEl}>
<ExtensionPoint point={SLIDER_POINT_ID} params={extParams}>
  {#snippet original()}
<div class="sf">
  <div class="sf-head">
    <span class="sf-label" title={label}>{label}</span>

    {#if onReset}
      <button class="sf-reset" onclick={onReset}>
        <Icon name="rollback" size={13} />
      </button>
    {/if}

    <label class="mpu-field sf-field">
      <input
        class="mpu-input"
        type="number"
        {min}
        {max}
        step="any"
        value={draft}
        onfocus={() => (focused = true)}
        onblur={() => {
          focused = false;
          commitDraft();
        }}
        oninput={(e) => (draft = e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            commitDraft();
            e.currentTarget.blur();
          }
        }}
      />
      {#if unit}<span class="mpu-field-unit">{unit}</span>{/if}
    </label>
  </div>

  <input
    class="sf-range"
    type="range"
    {min}
    {max}
    {step}
    value={draft}
    onpointerdown={() => (dragging = true)}
    oninput={(e) => {
      dragging = true;
      draft = Number(e.currentTarget.value).toFixed(decimals);
    }}
    onpointerup={() => (dragging = false)}
    onchange={(e) => {
      dragging = false;
      commitNumber(Number(e.currentTarget.value));
    }}
    onkeydown={() => (dragging = true)}
    onkeyup={(e) => {
      dragging = false;
      commitNumber(Number(e.currentTarget.value));
    }}
  />
</div>
  {/snippet}
</ExtensionPoint>
</div>

<style>
  .sf-host { display: contents; }

  .sf {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    min-width: 0;
  }

  .sf-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
  }

  /* Совсем нет места: поле уходит на вторую строку, а не наезжает на подпись */
  .sf-label {
    flex: 1 1 64px;
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sf-reset {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .sf-reset:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .sf-field {
    margin-top: 0;
    padding: 3px 8px;
    width: 120px;
    max-width: 100%;
    min-width: 0;
    flex: none;
  }

  .sf-field .mpu-input {
    width: auto;
    flex: 1;
    min-width: 0;
    text-align: end;
  }

  .sf-range {
    width: 100%;
    accent-color: var(--accent);
  }
</style>