<script lang="ts">
  import type { Severity } from '../../../health-utils';

  let { severity, label, title }: { severity: Severity; label: string; title?: string } = $props();
</script>

<span class="chip {severity}" {title}>
  <span class="dot" aria-hidden="true"></span>
  {label}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 1px var(--space-sm);
    border-radius: 999px;
    border: 1px solid currentColor;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--text-muted);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .chip.ok {
    color: var(--success);
  }

  .chip.warn {
    color: var(--warning);
  }

  .chip.crit {
    color: var(--danger);
  }
</style>
