<script lang="ts">
  import KlipperErrorHelp from '../../../shared/klipper-errors/KlipperErrorHelp.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();
</script>

<!-- The notification host owns placement; this element owns the action and its popover. -->
<KlipperErrorHelp hintId={params.hintId ?? null} compact />
