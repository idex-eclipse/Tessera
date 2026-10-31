<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import { createTesseract } from './tesseract';

  type Size = 'sm' | 'md' | 'lg';

  /**
   * `text` — подпись от места вызова. Не передан: для md/lg показывается
   * `common.loading`, для sm подпись только для скринридеров. Пустая строка
   * убирает видимую подпись.
   */
  let {
    size = 'md',
    text,
    inline = false,
    block = false,
  }: { size?: Size; text?: string; inline?: boolean; block?: boolean } = $props();

  // Контекст читается один раз при инициализации (getContext нельзя вызывать из
  // $derived/$effect). Загрузчик монтируется и до старта плагинов (сплэш), где
  // контекста нет — тогда подпись по умолчанию английская.
  let i18n: ReturnType<typeof usePluginApi>['i18n'] | null = null;
  try {
    i18n = usePluginApi().i18n;
  } catch {
    i18n = null;
  }

  // Функции, а не $derived: читаются в шаблоне и остаются реактивными к смене языка,
  // но не переживают разрушенный эффект (derived_inert).
  const label = (): string => text ?? i18n?.t('common.loading') ?? 'Loading';
  const visible = (): boolean => size !== 'sm' && label() !== '';

  let svg: SVGSVGElement;

  $effect(() => {
    const handle = createTesseract(svg);
    return () => handle.destroy();
  });
</script>

<span class="tessera-loader tl-{size}" class:tl-inline={inline} class:tl-block={block} role="status">
  <svg bind:this={svg} class="tl-cube" aria-hidden="true" focusable="false"></svg>
  <span class={visible() ? 'tl-text' : 'visually-hidden'}>{label()}</span>
</span>

<style>
  .tessera-loader {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    color: var(--accent);
    vertical-align: middle;
  }

  .tl-inline {
    flex-direction: row;
    gap: var(--space-xs);
  }

  .tl-block {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 80px;
    justify-content: center;
    padding: var(--space-md);
  }

  .tl-cube {
    display: block;
    flex-shrink: 0;
    overflow: visible;
  }

  .tl-cube :global(line) {
    stroke: currentColor;
    stroke-width: 3;
    stroke-linecap: round;
  }

  .tl-sm {
    color: inherit;
  }

  .tl-sm .tl-cube {
    width: 16px;
    height: 16px;
  }
  .tl-sm .tl-cube :global(line) {
    stroke-width: 6;
  }

  .tl-md .tl-cube {
    width: 28px;
    height: 28px;
  }
  .tl-md .tl-cube :global(line) {
    stroke-width: 4.5;
  }

  .tl-lg .tl-cube {
    width: 64px;
    height: 64px;
  }

  .tl-text {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .tl-lg .tl-text {
    font-size: var(--font-size-md);
  }
</style>
