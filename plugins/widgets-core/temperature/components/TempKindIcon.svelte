<script lang="ts">
  import Icon from '../../../shared/icons/Icon.svelte';

  let {
    kind,
    speed = null,
    size = 16,
    class: cls = '',
  }: {
    kind: 'heater' | 'fan' | 'sensor';
    speed?: number | null;
    size?: number;
    class?: string;
  } = $props();

  let spinD = $derived.by<string | null>(() => {
    if (kind !== 'fan' || speed == null || speed <= 0.02) return null;
    const s = Math.min(1, Math.max(0, speed));
    return `${(1.9 - 1.5 * s).toFixed(2)}s`;
  });
</script>

<Icon
  name={`kind-${kind}`}
  {size}
  cls={cls}
  style={spinD ? `--spin-d: ${spinD}` : ''}
/>