<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { pointAddress } from '../../core/extension-resolver';

  /**
   * Popover выбора варианта в точке alternative (ПКМ / long-press / openChooser).
   * Варианты: оригинал владельца и доступные вклады; выбор — per-printer.
   */
  const { extensions, i18n, loader } = getAppContext();

  let request = $derived(extensions.chooser);
  let pointState = $derived(
    request ? extensions.resolve(request.owner, request.pointId, request.params) : null,
  );
  let current = $derived(pointState?.active[0]?.ref ?? null);
  let point = $derived(
    request ? extensions.graph.points.get(pointAddress(request.owner, request.pointId)) : undefined,
  );
  let title = $derived(
    point?.decl.titleKey ? i18n.t(point.decl.titleKey) : i18n.t('extensions.chooser.title'),
  );
  let ownerName = $derived(
    request ? (loader.getLoadedPlugin(request.owner)?.manifest.name ?? request.owner) : '',
  );

  let el = $state<HTMLDivElement | null>(null);
  let pos = $state({ left: 0, top: 0 });

  // Вписать в окно: якорь — левый нижний угол элемента или точка клика.
  $effect(() => {
    if (!request || !el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    pos = {
      left: Math.max(margin, Math.min(request.x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(request.y, window.innerHeight - rect.height - margin)),
    };
  });

  $effect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') extensions.closeChooser();
    };
    const onDown = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node)) extensions.closeChooser();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  });

  function pick(ref: string | null): void {
    if (!request) return;
    extensions.setChoice(request.owner, request.pointId, ref);
    extensions.closeChooser();
  }
</script>

{#if request && pointState}
  <div
    class="chooser"
    bind:this={el}
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    role="menu"
    aria-label={title}
  >
    <div class="chooser-head">
      <span class="chooser-title">{title}</span>
      <span class="chooser-owner">{ownerName}</span>
    </div>
    <button class="item" class:active={current === null} role="menuitemradio" aria-checked={current === null} onclick={() => pick(null)}>
      <span class="mark">{current === null ? '●' : ''}</span>
      {i18n.t('extensions.chooser.original')}
    </button>
    {#each pointState.options as option (option.ref)}
      <button
        class="item"
        class:active={current === option.ref}
        role="menuitemradio"
        aria-checked={current === option.ref}
        onclick={() => pick(option.ref)}
      >
        <span class="mark">{current === option.ref ? '●' : ''}</span>
        {option.title}
        <span class="item-plugin">{loader.getLoadedPlugin(option.pluginId)?.manifest.name ?? option.pluginId}</span>
      </button>
    {/each}
    {#if pointState.options.length === 0}
      <p class="empty">{i18n.t('extensions.chooser.none')}</p>
    {/if}
  </div>
{/if}

<style>
  .chooser {
    position: fixed;
    z-index: 310;
    min-width: 220px;
    max-width: min(320px, calc(100vw - 16px));
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .chooser-head {
    display: flex;
    flex-direction: column;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 2px;
  }

  .chooser-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .chooser-owner,
  .item-plugin {
    font-size: 11px;
    color: var(--text-muted);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: start;
    cursor: pointer;
  }

  .item:hover {
    background: var(--bg-surface-hover);
  }

  .item.active {
    color: var(--accent);
    font-weight: 600;
  }

  .item-plugin {
    margin-inline-start: auto;
    font-weight: 400;
  }

  .mark {
    width: 1em;
    flex-shrink: 0;
    text-align: center;
  }

  .empty {
    margin: 0;
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  @media (pointer: coarse) {
    .item {
      min-height: 40px;
    }
  }
</style>
