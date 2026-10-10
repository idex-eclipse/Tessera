<script lang="ts">
  import {
    hexToHsv,
    hsvToHex,
    type HSV,
  } from './color-utils';

  let {
    value = null,
    onPick,
    i18n,
  }: {
    value: string | null;
    onPick: (hex: string | null) => void;
    i18n: { t: (key: string) => string };
  } = $props();

  const PRESETS = [
    '#4285f4', '#669df6', '#ea4335', '#f28b82',
    '#fbbc04', '#fdd663', '#34a853', '#81c995',
    '#ff6d00', '#c678dd', '#40c4ff', '#e06c75',
  ];

  let open = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let pos = $state({ top: 0, right: 0 });

  let hsv = $state<HSV>({ h: 220, s: 70, v: 90 });
  let hexInput = $state('');
  let isDragging = $state(false); // флаг активного drag

  // Sync from external value (игнорируем во время drag)
  $effect(() => {
    if (isDragging) return; // не перезаписываем hsv во время drag
    if (value) {
      const parsed = hexToHsv(value);
      if (parsed) {
        hsv = parsed;
        hexInput = value;
      }
    } else {
      hsv = { h: 220, s: 70, v: 90 };
      hexInput = '';
    }
  });

  function toggle(): void {
    if (!open && btnEl) {
      const r = btnEl.getBoundingClientRect();
      pos = { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) };
    }
    open = !open;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    if (!open) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let svEl = $state<HTMLDivElement | null>(null);
  let hEl = $state<HTMLDivElement | null>(null);

  function updateSV(e: MouseEvent | TouchEvent): void {
    if (!svEl) return;
    const rect = svEl.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(clientY - rect.top, rect.height));

    const s = Math.round((x / rect.width) * 100);
    const v = Math.round(100 - (y / rect.height) * 100);

    hsv = { ...hsv, s, v };
    const hex = hsvToHex(hsv);
    hexInput = hex;
    onPick(hex);
  }

  function updateH(e: MouseEvent | TouchEvent): void {
    if (!hEl) return;
    const rect = hEl.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;

    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const h = Math.round((x / rect.width) * 360);

    hsv = { ...hsv, h };
    const hex = hsvToHex(hsv);
    hexInput = hex;
    onPick(hex);
  }

  function onSVMouseDown(e: MouseEvent): void {
    e.preventDefault();
    isDragging = true;
    updateSV(e);
    const onMove = (ev: MouseEvent) => updateSV(ev);
    const onUp = () => {
      isDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onSVTouchStart(e: TouchEvent): void {
    e.preventDefault();
    isDragging = true;
    updateSV(e);
    const onMove = (ev: TouchEvent) => updateSV(ev);
    const onEnd = () => {
      isDragging = false;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }

  function onHMouseDown(e: MouseEvent): void {
    e.preventDefault();
    isDragging = true;
    updateH(e);
    const onMove = (ev: MouseEvent) => updateH(ev);
    const onUp = () => {
      isDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onHTouchStart(e: TouchEvent): void {
    e.preventDefault();
    isDragging = true;
    updateH(e);
    const onMove = (ev: TouchEvent) => updateH(ev);
    const onEnd = () => {
      isDragging = false;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }

  function onHexInput(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    hexInput = target.value;
    const normalized = target.value.startsWith('#') ? target.value : `#${target.value}`;
    const parsed = hexToHsv(normalized);
    if (parsed) {
      hsv = parsed;
      onPick(normalized.toLowerCase());
    }
  }

  let currentHex = $derived(hsvToHex(hsv));
</script>

<button
  class="swatch-btn"
  class:active={open}
  bind:this={btnEl}
  onclick={toggle}
  title={i18n.t('cp.color')}
  type="button"
>
  <span class="swatch" class:none={!value} style:background={value ?? undefined}></span>
</button>

{#if open}
  <div class="cp-backdrop" onclick={() => (open = false)} role="presentation"></div>

  <div class="cp-menu" style:top="{pos.top}px" style:right="{pos.right}px">
    <!-- пресеты + сброс -->
    <div class="cp-grid">
      <button
        class="swatch none"
        title={i18n.t('cp.colorReset')}
        onclick={() => onPick(null)}
        type="button"
      >
        <span class="slash"></span>
      </button>

      {#each PRESETS as hex (hex)}
        <button
          class="swatch"
          class:selected={value === hex}
          style:background={hex}
          onclick={() => onPick(hex)}
          type="button"
        ></button>
      {/each}
    </div>

    <div class="cp-sep"></div>

    <!-- квадрат Saturation/Value -->
    <div
      class="cp-sv"
      bind:this={svEl}
      style="--cp-h: {hsv.h}"
      onmousedown={onSVMouseDown}
      ontouchstart={onSVTouchStart}
      role="application"
      aria-label={i18n.t('cp.colorCustom')}
    >
      <span class="cp-cursor" style:left="{hsv.s}%" style:top="{100 - hsv.v}%"></span>
    </div>

    <!-- полоса Hue -->
    <div
      class="cp-hue"
      bind:this={hEl}
      onmousedown={onHMouseDown}
      ontouchstart={onHTouchStart}
      role="slider"
      aria-label={i18n.t('cp.color')}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={hsv.h}
    >
      <span class="cp-hue-cursor" style:left="{(hsv.h / 360) * 100}%"></span>
    </div>

    <!-- превью + hex -->
    <div class="cp-footer">
      <span class="cp-preview" style:background={currentHex}></span>
      <input
        class="cp-hex"
        type="text"
        value={hexInput}
        oninput={onHexInput}
        placeholder="#4285f4"
        spellcheck="false"
      />
    </div>
  </div>
{/if}

<style>
  .swatch-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
  }

  .swatch-btn:hover,
  .swatch-btn.active {
    background: var(--bg-surface-hover);
  }

  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    display: inline-block;
  }

  .swatch.none {
    background: var(--bg-surface);
    position: relative;
    overflow: hidden;
  }

  .swatch.none .slash {
    position: absolute;
    inset: -2px;
    background: linear-gradient(
      to top right,
      transparent 44%,
      var(--danger) 46%,
      var(--danger) 54%,
      transparent 56%
    );
  }

  .cp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .cp-menu {
    position: fixed;
    z-index: 461;
    width: 240px;
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .cp-grid {
    display: grid;
    grid-template-columns: repeat(6, 22px);
    gap: var(--space-xs);
  }

  .cp-grid .swatch {
    width: 22px;
    height: 22px;
    cursor: pointer;
    padding: 0;
    transition: transform var(--transition-fast);
  }

  .cp-grid .swatch:hover {
    transform: scale(1.15);
  }

  .cp-grid .swatch.selected {
    outline: 2px solid var(--text-primary);
    outline-offset: 1px;
  }

  .cp-sep {
    height: 1px;
    background: var(--border-color);
  }

  /* квадрат SV: hue через CSS-var, сверху градиенты value/saturation */
  .cp-sv {
    position: relative;
    height: 120px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    cursor: crosshair;
    touch-action: none;
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, transparent),
      hsl(var(--cp-h, 220), 100%, 50%);
  }

  .cp-cursor {
    position: absolute;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .cp-hue {
    position: relative;
    height: 12px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    cursor: pointer;
    touch-action: none;
    background: linear-gradient(
      to right,
      #f00 0%,
      #ff0 17%,
      #0f0 33%,
      #0ff 50%,
      #00f 67%,
      #f0f 83%,
      #f00 100%
    );
  }

  .cp-hue-cursor {
    position: absolute;
    top: -3px;
    width: 8px;
    height: 16px;
    border: 2px solid #fff;
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .cp-footer {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .cp-preview {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .cp-hex {
    flex: 1;
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-sm);
  }
</style>