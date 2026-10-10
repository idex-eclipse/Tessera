<script lang="ts">
  import Icon from '../icons/Icon.svelte';

  let { title, children }: {
    title: string;
    children: import('svelte').Snippet;
  } = $props();

  let open = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let pos = $state({ top: -9999, right: -9999 });

  function place(): void {
    const r = btnEl?.getBoundingClientRect();
    const el = menuEl;
    if (!r || !el) return;
    const mh = el.offsetHeight;
    const mw = el.offsetWidth;
    const spaceBelow = window.innerHeight - r.bottom - 4;
    let top: number;
    if (mh <= spaceBelow) top = r.bottom + 4;
    else if (mh <= r.top - 4) top = r.top - 4 - mh;
    else top = Math.max(8, window.innerHeight - mh - 8);
    const rightPreferred = Math.max(8, window.innerWidth - r.right);
    const right = Math.min(rightPreferred, Math.max(8, window.innerWidth - mw - 8));
    pos = { top, right };
  }

  function toggle(): void {
    if (!open) pos = { top: -9999, right: -9999 };
    open = !open;
  }

  $effect(() => {
    if (!open || !menuEl) return;
    place();
    const re = () => place();
    window.addEventListener('resize', re);
    document.addEventListener('scroll', re, true);
    return () => {
      window.removeEventListener('resize', re);
      document.removeEventListener('scroll', re);
    };
  });

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    if (!open) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<button
  class="hdr-btn"
  class:active={open}
  bind:this={btnEl}
  onclick={toggle}
  title={title}
>
  <Icon name="help-circle" size={15} />
</button>

{#if open}
  <div class="help-backdrop" onclick={() => (open = false)} role="presentation"></div>
  <div
    class="help-menu"
    bind:this={menuEl}
    style:top="{pos.top}px"
    style:right="{pos.right}px"
    role="dialog"
    aria-label={title}
  >
    <div class="help-title">{title}</div>
    <div class="help-body">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .hdr-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .hdr-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .hdr-btn.active { background: var(--accent); color: #fff; }

  .help-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .help-menu {
    position: fixed;
    z-index: 461;
    min-width: 280px;
    max-width: 380px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .help-title {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .help-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: 0 var(--space-sm) var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .help-body :global(h4) {
    margin: var(--space-xs) 0 2px;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .help-body :global(ul) {
    margin: 0;
    padding-left: 1.2em;
  }

  .help-body :global(li) {
    margin-bottom: 2px;
  }

  .help-body :global(code) {
    font-family: monospace;
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-surface-hover);
    color: var(--accent);
  }

  .help-body :global(.warn) {
    color: var(--warning);
    font-weight: 600;
  }
</style>