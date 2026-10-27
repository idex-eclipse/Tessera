<script lang="ts">
  import '../../../shared/input/inputs.css';
  import { useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import { formatCountdown, HOLD_MAX_MINUTES, type HoldPhase } from '../hold-timer';

  let {
    value = 0,
    phase = 'off',
    remainingMs = null,
    onCommit,
  }: {
    /** минуты; 0 — таймер выключен */
    value: number;
    phase?: HoldPhase;
    remainingMs?: number | null;
    onCommit: (minutes: number) => void;
  } = $props();

  const i18n = useI18n();

  let focused = $state(false);
  let draft = $state<string | number>('');
  let suppressBlurCommit = false;

  $effect(() => {
    if (focused) return;
    draft = value > 0 ? String(value) : '';
  });

  function commit(): void {
    const raw = String(draft ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      draft = value > 0 ? String(value) : '';
      return;
    }
    onCommit(Math.min(n, HOLD_MAX_MINUTES));
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

<label class="mpu-field hold-field" class:armed={phase === 'heating' || phase === 'holding'}>
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
      if (!skip) commit();
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
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
