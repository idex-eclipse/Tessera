<script lang="ts">
  import '../../../shared/input/inputs.css';
  import { useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import { formatCountdown, HOLD_MAX_MINUTES, parseHoldMinutes, type HoldPhase } from '../hold-timer';

  let {
    value = 0,
    phase = 'off',
    remainingMs = null,
    block = false,
    deferred = false,
    draft = $bindable<string | number>(''),
    onCommit,
  }: {
    /** минуты; 0 — таймер выключен */
    value: number;
    phase?: HoldPhase;
    remainingMs?: number | null;
    /** На всю ширину контейнера (popover), а не 110px колонки таблицы. */
    block?: boolean;
    /**
     * Не применять сам (ни по blur, ни по Enter): значением распоряжается форма вокруг поля —
     * текущий ввод читается через `bind:draft`, разбор — `parseHoldMinutes`.
     */
    deferred?: boolean;
    draft?: string | number;
    onCommit?: (minutes: number) => void;
  } = $props();

  const i18n = useI18n();

  let focused = $state(false);
  let suppressBlurCommit = false;

  $effect(() => {
    if (focused) return;
    draft = value > 0 ? String(value) : '';
  });

  function commit(): void {
    const n = parseHoldMinutes(draft);
    if (n === null) {
      draft = value > 0 ? String(value) : '';
      return;
    }
    onCommit?.(n);
  }

  // справа в поле: статус вместо единицы, пока таймер взведён
  let unit = $derived(
    phase === 'heating'
      ? i18n.t('widgets.temperature.holdHeating')
      : phase === 'holding' && remainingMs != null
        ? formatCountdown(remainingMs)
        : i18n.t('widgets.temperature.holdUnit'),
  );
</script>

<label class="mpu-field hold-field" class:block class:armed={phase === 'heating' || phase === 'holding'}>
  <input
    class="mpu-input"
    type="number"
    min="0"
    max={HOLD_MAX_MINUTES}
    step="any"
    placeholder="—"
    bind:value={draft}
    onfocus={() => (focused = true)}
    onblur={() => {
      const skip = suppressBlurCommit;
      suppressBlurCommit = false;
      focused = false;
      if (!skip && !deferred) commit();
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter' && !deferred) {
        commit();
        suppressBlurCommit = true;
        (e.currentTarget as HTMLInputElement).blur();
      }
    }}
  />

  <span class="mpu-field-unit unit">{unit}</span>
</label>

<style>
  .hold-field {
    width: 110px;
    flex: none;
    margin-top: 0;
    padding: 3px var(--space-xs);
    /* цифры и «мин»/«2:05» не должны переставляться местами в RTL */
    direction: ltr;
  }

  .hold-field.block { width: 100%; flex: 1; }

  .hold-field .mpu-input {
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-md);
  }

  .hold-field .unit {
    min-width: 2.2em;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .hold-field.armed {
    border-color: color-mix(in srgb, var(--heat) 50%, var(--border-color));
  }

  .hold-field.armed .unit {
    color: var(--heat);
  }
</style>
