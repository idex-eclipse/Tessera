<script lang="ts">
  import type { Severity } from '../../../../lib/health-utils';

  let {
    severity,
    label,
    title,
    borderless = false,
    size = 'sm',
  }: {
    severity: Severity;
    label: string;
    title?: string;
    borderless?: boolean;
    /** md — для крупных кнопок (fleet-индикатор); sm — компактные таблицы и полосы */
    size?: 'sm' | 'md';
  } = $props();
</script>

<span class="chip {severity}" class:borderless class:md={size === 'md'} {title}>
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
    font-size: var(--font-size-xs);
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

  /* Наборы с собственной рамкой (кнопка-индикатор fleet) рисуют чип без второй обводки. */
  .chip.borderless {
    border-color: transparent;
  }

  /* Крупный вариант: текст и точка на уровень крупнее компактного табличного. */
  .chip.md {
    gap: var(--space-sm);
    font-size: var(--font-size-md);
  }

  .chip.md .dot {
    width: 10px;
    height: 10px;
  }
</style>
