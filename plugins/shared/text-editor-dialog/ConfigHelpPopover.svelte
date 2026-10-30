<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { highlightKlipperLines, toRenderLines } from './highlight';
  import { HELP_WIDTH, placePopup, type Anchor } from './help-position';
  import type { HelpView } from './config-reference';
  import type { Inline } from './mini-markdown';

  let {
    section,
    view,
    anchor,
    narrow,
    dir,
    i18n,
    onClose,
    onRetry,
  }: {
    section: string;
    view: HelpView;
    anchor: Anchor;
    narrow: boolean;
    dir: 'ltr' | 'rtl';
    i18n: { t: (key: string, params?: Record<string, string | number>) => string };
    onClose: () => void;
    onRetry: () => void;
  } = $props();

  // десктоп: fixed у якоря; узкий экран: bottom sheet (стили .sheet)
  let place = $derived(
    narrow
      ? null
      : placePopup(anchor, { w: HELP_WIDTH, h: 360 }, { w: window.innerWidth, h: window.innerHeight }),
  );

  // highlightKlipperLines экранирует текст; прозу в {@html} не отдаём
  function codeHtml(code: string): string {
    return toRenderLines(highlightKlipperLines(code), code).join('');
  }
</script>

{#snippet inl(nodes: Inline[])}
  {#each nodes as n, i (i)}
    {#if n.t === 'text'}{n.v}
    {:else if n.t === 'code'}<code>{n.v}</code>
    {:else if n.t === 'bold'}<strong>{@render inl(n.v)}</strong>
    {:else if n.t === 'italic'}<em>{@render inl(n.v)}</em>
    {:else if n.t === 'link' && n.external}<a href={n.href} target="_blank" rel="noopener noreferrer">{n.text}</a>
    {:else if n.t === 'link'}<span class="help-link" title={n.href}>{n.text}</span>
    {/if}
  {/each}
{/snippet}

<div class="help-backdrop" class:dim={narrow} onclick={onClose} role="presentation"></div>
<div
  class="help-pop"
  class:sheet={narrow}
  style:left={place ? `${place.left}px` : undefined}
  style:top={place?.top != null ? `${place.top}px` : undefined}
  style:bottom={place?.bottom != null ? `${place.bottom}px` : undefined}
  style:max-height={place ? `${place.maxHeight}px` : undefined}
  style:width={narrow ? undefined : `min(${HELP_WIDTH}px, calc(100vw - 16px))`}
  {dir}
  role="dialog"
  aria-label={i18n.t('ft.help.title')}
>
  <div class="help-head">
    <div class="help-titles">
      <span class="help-name" dir="ltr">[{section}]</span>
      {#if view.status === 'ready'}
        <span class="help-sub" dir="ltr">{i18n.t('ft.help.source')} · [{view.fragment.heading}]</span>
      {/if}
    </div>
    <button class="help-x" title={i18n.t('ft.help.close')} aria-label={i18n.t('ft.help.close')} onclick={onClose}>
      <Icon name="x" size={14} />
    </button>
  </div>

  <div class="help-body">
    {#if view.status === 'loading'}
      <div class="help-state">
        <span class="help-spinner"></span>
        <span>{i18n.t('ft.help.loading')}</span>
      </div>
    {:else if view.status === 'notFound'}
      <div class="help-state">{i18n.t('ft.help.notFound', { name: section })}</div>
    {:else if view.status === 'unavailable'}
      <div class="help-state">{i18n.t('ft.help.unavailable')}</div>
    {:else if view.status === 'error'}
      <div class="help-state">
        <span>{i18n.t('ft.help.error')}</span>
        {#if view.message}<span class="help-err" dir="ltr">{view.message}</span>{/if}
        <button class="help-retry" onclick={onRetry}>{i18n.t('ft.help.retry')}</button>
      </div>
    {:else}
      {#each view.blocks as b, i (i)}
        {#if b.t === 'code'}
          <pre class="help-code" dir="ltr">{@html codeHtml(b.text)}</pre>
        {:else if b.t === 'heading'}
          <div class="help-h">{@render inl(b.inline)}</div>
        {:else if b.t === 'list'}
          <ul class="help-list">
            {#each b.items as item, j (j)}
              <li>{@render inl(item)}</li>
            {/each}
          </ul>
        {:else}
          <p class="help-p">{@render inl(b.inline)}</p>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .help-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: transparent;
  }
  .help-backdrop.dim { background: rgba(0, 0, 0, 0.35); }

  .help-pop {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
  }

  .help-pop.sheet {
    inset-inline: 0;
    bottom: 0;
    max-height: 70dvh;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    border-bottom: none;
  }

  .help-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .help-titles { display: flex; flex-direction: column; min-width: 0; }

  .help-name {
    font-family: monospace;
    font-size: var(--font-size-md);
    font-weight: 600;
    word-break: break-all;
  }

  .help-sub {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-muted);
    word-break: break-all;
  }

  .help-x {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .help-x:hover { background: var(--bg-surface-hover); color: var(--text-primary); }

  .help-body {
    overflow-y: auto;
    padding: var(--space-sm);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }

  .help-p { margin: 0 0 var(--space-sm); }
  .help-p:last-child { margin-bottom: 0; }

  .help-h {
    margin: var(--space-sm) 0 var(--space-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .help-list { margin: 0 0 var(--space-sm); padding-inline-start: 1.2em; }

  .help-body code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--bg-surface-hover);
    font-family: monospace;
    font-size: 0.95em;
  }

  .help-link { color: var(--accent); }
  .help-body a { color: var(--accent); }

  .help-code {
    margin: 0 0 var(--space-sm);
    padding: var(--space-sm);
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app, var(--bg-surface-hover));
    font-family: monospace;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre;
    tab-size: 4;
  }

  .help-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-md);
    color: var(--text-muted);
    text-align: center;
  }

  .help-err { font-family: monospace; font-size: 11px; word-break: break-word; }

  .help-retry {
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .help-spinner {
    width: 22px;
    height: 22px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: help-spin 0.8s linear infinite;
  }
  @keyframes help-spin { to { transform: rotate(360deg); } }
</style>
