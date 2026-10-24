<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { createFileOps } from '../../../shared/file-table/file-ops.ts';
  import FileTable from '../../../shared/file-table/FileTable.svelte';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { jobsCustomAction, jobsMenuItems } from '../../jobs-menu.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const ops = createFileOps(api);
  const klippy = useKlippyState(api);
</script>

<FileTable
  root="gcodes"
  scope="widget:gcodes"
  mode="gcode"
  showHeader={false}
  menuItems={(ref, isDir) => jobsMenuItems(i18n, ref, isDir, klippy.ready)}
  onAction={(id, ref) => jobsCustomAction(api, ops, id, ref, klippy.ready)}
/>