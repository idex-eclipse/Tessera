<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import { createFileOps } from '../shared/file-table/file-ops';
  import FileTable from '../shared/file-table/FileTable.svelte';
  import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';
  import ThreeMFInspector from '../shared/3mf-parser/3Mf-Inspector.svelte';
  import { openThreeMF } from '../shared/3mf-parser/parser';
  import type { ThreeMFHandle } from '../shared/3mf-parser/types'

  import { jobsCustomAction, jobsMenuItems } from './jobs-menu';

  const api = usePluginApi();
  const i18n = api.i18n;
  const ops = createFileOps(api);
  const klippy = useKlippyState(api);

  // ------------------------------------------------------------------
  // 3MF Inspector state
  // ------------------------------------------------------------------

  let inspectorHandle = $state<ThreeMFHandle | null>(null);
  let inspectorOpen = $state(false);
  let inspectorBusy = $state(false);
  let inspectorError = $state('');

  async function handleThreeMF(file: File): Promise<void> {
    inspectorError = '';
    try {
      const handle = await openThreeMF(file);
      inspectorHandle = handle;
      inspectorOpen = true;
    } catch (err) {
      inspectorError = i18n.t('jobs.uploadPrint.parseFailed');
    }
  }

  async function handleUpload(plateId: number): Promise<void> {
    if (!inspectorHandle || inspectorBusy) return;
    
    const plate = inspectorHandle.inspection.plates.find((p) => p.id === plateId);
    if (!plate?.gcodePath) return;

    inspectorBusy = true;
    try {
      const blob = await inspectorHandle.plateGcode(plateId);
      const filename = `${inspectorHandle.inspection.vendor}_plate${plateId}.gcode`;
      
      const fd = new FormData();
      fd.append('root', 'gcodes');
      fd.append('print', 'false');
      fd.append('file', blob, filename);

      const h = api.moonraker();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${h.httpBaseUrl}/server/files/upload`);
      const tok = (h as { authToken?: string }).authToken;
      if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('upload_failed'));
        };
        xhr.onerror = () => reject(new Error('upload_error'));
        xhr.send(fd);
      });

      inspectorOpen = false;
      inspectorHandle = null;
    } catch {
      inspectorError = i18n.t('jobs.uploadPrint.uploadFailed');
    } finally {
      inspectorBusy = false;
    }
  }

  async function handleUploadAndPrint(plateId: number): Promise<void> {
    if (!inspectorHandle || inspectorBusy || !klippy.ready) return;
    
    const plate = inspectorHandle.inspection.plates.find((p) => p.id === plateId);
    if (!plate?.gcodePath) return;

    inspectorBusy = true;
    try {
      const blob = await inspectorHandle.plateGcode(plateId);
      const filename = `${inspectorHandle.inspection.vendor}_plate${plateId}.gcode`;
      
      const fd = new FormData();
      fd.append('root', 'gcodes');
      fd.append('print', 'true');
      fd.append('file', blob, filename);

      const h = api.moonraker();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${h.httpBaseUrl}/server/files/upload`);
      const tok = (h as { authToken?: string }).authToken;
      if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('upload_failed'));
        };
        xhr.onerror = () => reject(new Error('upload_error'));
        xhr.send(fd);
      });

      inspectorOpen = false;
      inspectorHandle = null;
    } catch {
      inspectorError = i18n.t('jobs.uploadPrint.uploadFailed');
    } finally {
      inspectorBusy = false;
    }
  }

  // Обёртка для перехвата .3mf файлов при попытке печати из меню
  async function wrappedOnAction(id: string, ref: any): Promise<void> {
    if (id === 'print' && ref.path?.toLowerCase().endsWith('.3mf')) {
      // Скачиваем .3mf с Moonraker и открываем инспектор
      try {
        const encodedPath = ref.path.split('/').map(encodeURIComponent).join('/');
        const response = await fetch(`${api.moonraker().httpBaseUrl}/server/files/${ref.root}/${encodedPath}`);
        if (!response.ok) throw new Error('download_failed');
        const blob = await response.blob();
        const file = new File([blob], ref.path.split('/').pop() ?? 'project.3mf', { type: 'application/octet-stream' });
        await handleThreeMF(file);
      } catch (err) {
        inspectorError = i18n.t('jobs.uploadPrint.downloadFailed');
      }
      return;
    }
    // Для всех остальных действий — обычный обработчик
    await jobsCustomAction(api, ops, id, ref, klippy.ready);
  }

  // canPrint для инспектора: klippy.ready && не печатает (можно добавить проверку print_stats.state)
  let canPrint = $derived(klippy.ready);
  let printHint = $derived(!klippy.ready ? i18n.t('common.klipperNotReady') : '');
</script>

<div class="jobs-page">
  <FileTable
    root="gcodes"
    scope="page:gcodes"
    mode="gcode"
    showAdd
    title={i18n.t('jobs.title')}
    menuItems={(ref, isDir) => jobsMenuItems(i18n, ref, isDir, klippy.ready)}
    onAction={wrappedOnAction}
    onThreeMF={handleThreeMF}
  />

  <ThreeMFInspector
    open={inspectorOpen}
    handle={inspectorHandle}
    busy={inspectorBusy}
    canPrint={canPrint}
    printHint={printHint}
    t={i18n.t}
    onClose={() => {
      inspectorOpen = false;
      inspectorHandle = null;
    }}
    onUpload={handleUpload}
    onUploadAndPrint={handleUploadAndPrint}
  />
</div>

<style>
  .jobs-page { height: 100%; }
</style>