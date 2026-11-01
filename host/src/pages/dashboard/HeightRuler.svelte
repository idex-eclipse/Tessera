<script lang="ts">
  let {
    h,
    min,
    max,
    rowStep,
    label,
    onStart,
    onChange,
    onCommit,
  }: {
    h: number;
    min: number;
    max: number;
    /** Высота ряда с зазором, px: одна риска = один ряд карточки. */
    rowStep: number;
    label: string;
    onStart: () => void;
    onChange: (h: number) => void;
    onCommit: () => void;
  } = $props();

  let drag: { pointerId: number; y: number; h: number } | null = null;
  let dragging = $state(false);
  let changed = false;

  const clamp = (value: number): number => Math.min(max, Math.max(min, value));

  function apply(next: number): void {
    if (next === h) return;
    changed = true;
    onChange(next);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { pointerId: e.pointerId, y: e.clientY, h };
    dragging = true;
    changed = false;
    onStart();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    apply(clamp(drag.h + Math.round((e.clientY - drag.y) / rowStep)));
  }

  function onPointerEnd(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    dragging = false;
    if (changed) onCommit();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = clamp(h + (e.key === 'ArrowDown' ? 1 : -1));
    if (next === h) return;
    onStart();
    onChange(next);
    onCommit();
  }
</script>

<!-- Шкала отсчитывается от нижнего края: он совпадает с низом карточки, поэтому риски стоят на её рядах -->
<div class="ruler" style={`--row-step: ${rowStep}px;`}>
  <div
    class="thumb"
    class:dragging
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={h}
    title={label}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
    onkeydown={onKeyDown}
  >
    <span class="grip"></span>
  </div>
</div>

<style>
  .ruler {
    position: relative;
    min-height: 0;
    border-radius: var(--radius-sm);
    background: repeating-linear-gradient(
      to top,
      var(--text-muted) 0 1px,
      transparent 1px var(--row-step)
    );
    background-color: var(--bg-surface-hover);
    /* Свайп по шкале прокручивает страницу; жест высоты начинается только с ползунка */
    touch-action: pan-y;
  }

  .thumb {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    height: var(--touch-target);
    cursor: ns-resize;
    user-select: none;
    touch-action: none;
  }

  .grip {
    width: 100%;
    height: 14px;
    border-radius: var(--radius-sm);
    background: var(--accent);
  }

  .thumb.dragging .grip,
  .thumb:focus-visible .grip {
    outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
    outline-offset: 1px;
  }

  .thumb:focus-visible {
    outline: none;
  }
</style>
