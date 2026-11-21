<script lang="ts">
  /** The probe exposes fleet bindings without mounting Moonraker-backed file stores. */
  let { printerId, showHeaderTitle, embedded }: {
    printerId?: string;
    showHeaderTitle?: boolean;
    embedded?: boolean;
  } = $props();
</script>

<div data-testid="jobs-browser" data-printer={printerId} data-title={showHeaderTitle} data-embedded={embedded}>
  full-file-actions-and-3mf
</div>
