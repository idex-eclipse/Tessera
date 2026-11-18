<script lang="ts">
  import { editorSession } from '../../state/editor-session.svelte';

  let { printerId }: { printerId: string } = $props();
  // A derived read of an unopened printer reproduces the original render failure.
  let session = $derived(editorSession(printerId));
</script>

<span>{session.tabs[0]?.content ?? ''}:{String(session.tabs[0]?.loading ?? false)}</span>
