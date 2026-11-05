<script lang="ts">
  // Test fixture: renders one reactive setting, the way a widget does.
  import type { SettingsHost } from '../../settings/watch-settings';
  import { useSetting } from '../../settings/create-setting.svelte';
  import { asBoolean } from '../../settings/parsers';

  let { api, expose }: { api: SettingsHost; expose?: (s: { set(v: boolean): void }) => void } = $props();

  // svelte-ignore state_referenced_locally
  const flag = useSetting(api, 'flag', false, asBoolean);
  // svelte-ignore state_referenced_locally
  expose?.(flag);
</script>

<span data-testid="flag">{String(flag.value)}</span>
