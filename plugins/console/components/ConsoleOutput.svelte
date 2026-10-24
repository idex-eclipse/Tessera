<script lang="ts">
  import type { ConsoleLine } from '../console-session.svelte';

  /**
   * Лог консоли — общий для страницы и виджета. Строки — G-code / ответы Klipper, поэтому
   * блок всегда ltr (в RTL-интерфейсе лог не «переворачивается»). Клик (или Enter) по
   * отправленной команде возвращает её в поле ввода.
   */
  let {
    lines,
    reverse,
    autoscroll,
    emptyText,
    compact = false,
    showTime = false,
    onPick,
  }: {
    lines: ConsoleLine[];
    reverse: boolean;
    autoscroll: boolean;
    emptyText: string;
    compact?: boolean;
    showTime?: boolean;
    onPick: (text: string) => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  $effect(() => {
    void lines;
    void reverse;
    if (!el || !autoscroll) return;
    el.scrollTop = reverse ? 0 : el.scrollHeight;
  });

  function onKey(e: KeyboardEvent, text: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(text);
    }
  }
</script>

<div class="console-output" class:compact dir="ltr" bind:this={el}>
  {#each lines as line (line.id)}
    {#if line.kind === 'sent'}
      <div
        class="line line-sent clickable"
        role="button"
        tabindex="0"
        onclick={() => onPick(line.text)}
        onkeydown={(e) => onKey(e, line.text)}
      >
        {#if showTime}<span class="line-time">{line.time}</span>{/if}
        <span class="line-prefix">&gt;</span>
        <span class="line-text">{line.text}</span>
      </div>
    {:else}
      <div class="line line-{line.kind}">
        {#if showTime}<span class="line-time">{line.time}</span>{/if}
        <span class="line-text">{line.text}</span>
      </div>
    {/if}
  {:else}
    <p class="console-empty" dir="auto">{emptyText}</p>
  {/each}
</div>

<style>
  .console-output {
    order: 1;
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    background: var(--bg-surface-hover-no-override);
    border-radius: var(--radius-sm);
    padding: var(--space-sm) var(--space-md);
    font-family: monospace;
    font-size: var(--font-size-md);
  }

  .console-output.compact {
    min-height: 0;
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
  }

  .line { display: flex; gap: var(--space-sm); padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
  .compact .line { gap: var(--space-xs); }
  .line-time { color: var(--text-muted); flex-shrink: 0; }
  .line-prefix { color: var(--accent); font-weight: 700; flex-shrink: 0; }
  .line-sent .line-text { color: var(--accent); font-weight: 600; }
  .line-response .line-text { color: var(--text-primary); }
  .line-system .line-text { color: var(--text-muted); font-style: italic; }

  .line.clickable { cursor: pointer; border-radius: var(--radius-xs); }
  .line.clickable:hover { background: var(--bg-surface-active); }
  .line.clickable:focus-visible { outline: 1px solid var(--border-focus); }

  .console-empty { margin: 0; color: var(--text-muted); font-style: italic; text-align: start; }
</style>
