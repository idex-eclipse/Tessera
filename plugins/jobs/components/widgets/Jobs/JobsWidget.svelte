<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import { createFileOps } from '../../../../shared/file-table/file-ops.ts';
  import FileTable from '../../../../shared/file-table/FileTable.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { jobsCustomAction, jobsMenuItems } from '../../../lib/jobs-menu.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const ops = createFileOps(api);
  const klippy = useKlippyState(api);
</script>

<!-- widget-table replaces the whole body; the header (toolbar) is a separate element and stays -->
<ExtensionPoint point="widget-table">
  {#snippet original()}
    <FileTable
      root="gcodes"
      scope="widget:gcodes"
      mode="gcode"
      showHeader={false}
      menuItems={(ref, isDir) => jobsMenuItems(i18n, ref, isDir, klippy.ready)}
      onAction={(id, ref) => jobsCustomAction(api, ops, id, ref, klippy.ready)}
    />
  {/snippet}
</ExtensionPoint>
