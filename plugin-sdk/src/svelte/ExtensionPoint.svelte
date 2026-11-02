<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { ExtensionPointState, MpuParams } from '../types';
  import { usePluginApi } from './use-plugin-api';

  /**
   * Точка расширения владельца (tab / panel / element).
   *
   * - append: рендерит оригинал (snippet `original`, если есть) и все активные вклады;
   * - alternative / replacement: оригинал рендерится ТОЛЬКО когда он выбран/не заменён —
   *   лишних подписок нет; для alternative ПКМ, долгое нажатие и клавиша ContextMenu
   *   открывают popover выбора хоста (если внутренний контент не сделал preventDefault).
   * - `only` — показать один вклад (тело вкладки дополнения в точке tab/append).
   *
   * Вклады монтирует хост, с api дополнения.
   */
  let {
    point,
    params = {},
    only,
    original,
  }: {
    point: string;
    params?: MpuParams;
    only?: string;
    original?: Snippet;
  } = $props();

  const api = usePluginApi();

  // Ядро разделяет рантайм Svelte с хостом, но удалённые владельцы — нет:
  // явная подписка делает обёртку реактивной в обоих случаях.
  let version = $state(0);
  $effect(() => api.extensions.onChange(() => version++));

  let pointState = $derived.by<ExtensionPointState>(() => {
    void version;
    return api.extensions.resolve(point, params);
  });

  let targets = $derived(only ? pointState.active.filter((r) => r.ref === only) : pointState.active);
  let choosable = $derived(pointState.mode === 'alternative' && pointState.options.length > 0);

  function openAt(x: number, y: number, target: EventTarget | null): void {
    if (x === 0 && y === 0 && target instanceof HTMLElement) {
      // contextmenu с клавиатуры приходит без координат
      api.extensions.openChooser(point, target, params);
      return;
    }
    api.extensions.openChooser(point, { x, y }, params);
  }

  function onContextMenu(e: MouseEvent): void {
    if (!choosable || e.defaultPrevented) return;
    e.preventDefault();
    openAt(e.clientX, e.clientY, e.target);
  }

  // Долгое нажатие на touch (500 мс, сдвиг до 10px).
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressStart = { x: 0, y: 0 };

  function cancelPress(): void {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!choosable || e.pointerType !== 'touch') return;
    pressStart = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      openAt(pressStart.x, pressStart.y, null);
    }, 500);
  }

  function onPointerMove(e: PointerEvent): void {
    if (pressTimer === null) return;
    if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
  }

  $effect(() => cancelPress);

  function mountExtension(node: HTMLElement, arg: { ref: string; params: MpuParams }) {
    const m = api.extensions.mount(node, arg.ref, arg.params);
    return {
      update(next: { ref: string; params: MpuParams }) {
        m.update(next.params);
      },
      destroy() {
        m.destroy();
      },
    };
  }
</script>

<div
  class="mpu-ext-point"
  data-point={point}
  oncontextmenu={onContextMenu}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={cancelPress}
  onpointercancel={cancelPress}
  role="presentation"
>
  {#if pointState.original && original && !only}
    {@render original()}
  {/if}
  {#each targets as target (target.ref)}
    <div class="mpu-ext-item" use:mountExtension={{ ref: target.ref, params }}></div>
  {/each}
</div>

<style>
  .mpu-ext-point {
    display: contents;
  }

  .mpu-ext-item {
    min-width: 0;
  }
</style>
