<script lang="ts">
  import type { Snippet } from 'svelte';

  import Icon from './icons/Icon.svelte';

  /** Shared shell keeps core fleet dialogs below their nested editors and viewers. */
  let {
    open,
    title,
    closeLabel,
    size = 'wide',
    onClose,
    children,
  }: {
    open: boolean;
    title: string;
    closeLabel: string;
    size?: 'wide' | 'medium';
    onClose: () => void;
    children: Snippet;
  } = $props();

  let dialog: HTMLElement | null = $state(null);
  const titleId = `fleet-dialog-${Math.random().toString(36).slice(2)}`;

  /** Trap keyboard focus while preserving the element that opened the fleet dialog. */
  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => dialog?.focus());
    const onKeydown = (event: KeyboardEvent) => {
      // Nested confirmations, viewers and the 3MF inspector own Escape while they are mounted.
      const modalStack = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
      if (modalStack.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture prevents the host Fleet Escape handler from closing the whole drawer.
    document.addEventListener('keydown', onKeydown, true);
    return () => {
      document.removeEventListener('keydown', onKeydown, true);
      queueMicrotask(() => previous?.focus());
    };
  });

  function closeBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }
</script>

{#if open}
  <div class="fleet-dialog-backdrop" role="presentation" onclick={closeBackdrop}>
    <div
      bind:this={dialog}
      class:medium={size === 'medium'}
      class="fleet-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button class="close" type="button" aria-label={closeLabel} title={closeLabel} onclick={onClose}>
          <Icon name="x" size={22} />
        </button>
      </header>
      <div class="content">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .fleet-dialog-backdrop {
    position: fixed;
    z-index: 250;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-md);
    background: color-mix(in srgb, var(--bg-base) 72%, transparent);
  }
  .fleet-dialog {
    position: fixed;
    z-index: 251;
    inset: 0;
    width: min(1200px, calc(100vw - 2 * var(--space-md)));
    height: min(800px, 80dvh);
    margin: auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
  }
  .fleet-dialog.medium {
    width: min(760px, calc(100vw - 2 * var(--space-md)));
    height: min(720px, 80dvh);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-height: 52px;
    padding-inline: var(--space-md) var(--space-xs);
    border-block-end: 1px solid var(--border-color);
    flex: 0 0 auto;
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--font-size-lg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .close:hover,
  .close:focus-visible {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* Narrow screens preserve logical padding and a 44px close target without page overflow. */
  @media (max-width: 768px) {
    .fleet-dialog-backdrop { padding: var(--space-xs); }
    .fleet-dialog,
    .fleet-dialog.medium {
      width: calc(100vw - 2 * var(--space-xs));
      height: calc(100dvh - 2 * var(--space-xs));
      max-height: none;
      border-radius: var(--radius-md);
    }
    header { padding-inline-start: var(--space-sm); }
  }
</style>
