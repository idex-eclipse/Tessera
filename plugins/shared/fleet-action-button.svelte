<script lang="ts">
  import Icon from './icons/Icon.svelte';

  /** Compact fleet panels use one consistent, touch-friendly action surface. */
  let { label, icon, onclick }: { label: string; icon: string; onclick: () => void } = $props();
</script>

<button type="button" {onclick} aria-label={label} title={label}>
  <Icon name={icon} size={20} />
  <span>{label}</span>
</button>

<style>
  button {
    width: 100%;
    height: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    padding-inline: var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }
  button:hover,
  button:focus-visible {
    border-color: var(--accent);
    background: var(--bg-surface-hover);
    color: var(--accent);
  }
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
