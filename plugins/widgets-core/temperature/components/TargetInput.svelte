<script lang="ts">
  import '../../../shared/input/inputs.css';

  let {
    value = null,
    onCommit,
  }: {
    value: number | null;
    onCommit: (v: number) => void;
  } = $props();

  let focused = $state(false);
  let draft = $state<string | number>('');
  let suppressBlurCommit = false;

  let pendingCommit = $state<number | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (focused) return;
    if (pendingCommit != null) {
      if (value != null && Math.round(value) === pendingCommit) {
        pendingCommit = null;
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        draft = String(Math.round(value));
      }
      return;
    }
    draft = value != null ? String(Math.round(value)) : '';
  });

  function commit(): void {
    const raw = String(draft ?? '').trim();
    if (raw === '') return;

    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;

    pendingCommit = n;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingCommit = null;
      pendingTimer = null;
    }, 3000);

    onCommit(n);
  }
</script>

<label class="mpu-field target-field">
  <input
    class="mpu-input"
    type="number"
    min="0"
    step="1"
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

  <span class="mpu-field-unit">°C</span>
</label>

<style>
  .target-field {
    width: 110px;
    flex: none;
    margin-top: 0;
    padding: 3px var(--space-xs);
  }

  .target-field .mpu-input {
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-md);
  }
</style>