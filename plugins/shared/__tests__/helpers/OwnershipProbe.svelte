<script lang="ts">
  // Test fixture: a component that gets (or creates) a keep-alive core during its init and renders
  // a derived value of it, exactly like a widget using a use-* hook.
  let { getCore }: { getCore: () => { doubled: number } } = $props();
  const core = getCore();
</script>

<span data-testid="value">{core.doubled}</span>
