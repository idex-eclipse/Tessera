<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import FileTable from '../../../shared/file-table/FileTable.svelte';
  import { createFileOps, type FileRef } from '../../../shared/file-table/file-ops.ts';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import ThreeMFInspector from '../../../shared/3mf-parser/3Mf-Inspector.svelte';
  import { openThreeMF } from '../../../shared/3mf-parser/parser.ts';
  import type { ThreeMFHandle } from '../../../shared/3mf-parser/types.ts';

  import { is3mf, jobsCustomAction, jobsMenuItems } from '../../lib/jobs-menu.ts';
  import { acquireJobsModal } from '../../state/page-ui-state.svelte.ts';

  /** Reusable Jobs browser follows the active printer unless fleet supplies a fixed target. */
  let {
    scope,
    printerId,
    inspectPath,
    showHeaderTitle = true,
    embedded = false,
  }: {
    scope: string;
    printerId?: string;
    inspectPath?: string;
    showHeaderTitle?: boolean;
    embedded?: boolean;
  } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const targetPrinterId = (): string => printerId ?? api.printer.id;
  const ops = createFileOps(api, printerId);
  const klippy = useKlippyState(api, printerId);

  function reasonOf(error: unknown): string | null {
    const reasonKey = (error as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
    return reasonKey ? i18n.t(reasonKey) : null;
  }

  let printing = $state(false);
  $effect(() => {
    const target = targetPrinterId();
    if (!target) return;
    return api.moonrakerFor(target).subscribe(
      { print_stats: ['state'] },
      (data: unknown) => {
        const state = (data as { print_stats?: { state?: unknown } } | null)?.print_stats?.state;
        if (typeof state === 'string') printing = state === 'printing' || state === 'paused';
      },
      { immediate: true },
    );
  });

  let inspectorHandle = $state<ThreeMFHandle | null>(null);
  let inspectorOpen = $state(false);
  let inspectorBusy = $state(false);
  let inspectorError = $state('');

  // The counter preserves the parent fleet lock while the nested inspector opens and closes.
  $effect(() => {
    if (!inspectorOpen) return;
    return acquireJobsModal();
  });

  async function handleThreeMF(file: File): Promise<void> {
    inspectorError = '';
    try {
      inspectorHandle = await openThreeMF(file);
      inspectorOpen = true;
    } catch {
      inspectorError = i18n.t('jobs.uploadPrint.parseFailed');
    }
  }

  async function openThreeMFFromPrinter(ref: FileRef): Promise<void> {
    inspectorError = '';
    try {
      const blob = await ops.readBlob(ref);
      const name = ref.path.split('/').pop() ?? 'project.3mf';
      await handleThreeMF(new File([blob], name, { type: 'application/octet-stream' }));
    } catch {
      inspectorError = i18n.t('jobs.uploadPrint.downloadFailed');
    }
  }

  let inspectHandled = '';
  $effect(() => {
    const path = inspectPath;
    if (!path || path === inspectHandled || !is3mf(path)) return;
    inspectHandled = path;
    void openThreeMFFromPrinter({ root: 'gcodes', path, isDir: false });
  });

  /** Upload plate G-code first, then route print through guarded Moonraker requests. */
  async function uploadPlate(plateId: number, print: boolean): Promise<void> {
    const handle = inspectorHandle;
    if (!handle || inspectorBusy || (print && !canPrint)) return;
    const plate = handle.inspection.plates.find((candidate) => candidate.id === plateId);
    if (!plate?.gcodePath) return;

    inspectorBusy = true;
    inspectorError = '';
    let stage: 'upload' | 'start' = 'upload';
    try {
      const blob = await handle.plateGcode(plateId);
      const filename = `${handle.inspection.vendor}_plate${plateId}.gcode`;
      await ops.upload('gcodes', '', new File([blob], filename, { type: 'application/octet-stream' }));
      if (print) {
        stage = 'start';
        await ops.startPrint({ root: 'gcodes', path: filename, isDir: false });
      }
      inspectorOpen = false;
      inspectorHandle = null;
    } catch (error) {
      inspectorError = stage === 'start'
        ? (reasonOf(error) ?? i18n.t('jobs.uploadPrint.startFailed'))
        : i18n.t('jobs.uploadPrint.uploadFailed');
    } finally {
      inspectorBusy = false;
    }
  }

  async function handleAction(id: string, ref: FileRef): Promise<void> {
    if (id === 'print' && is3mf(ref.path)) {
      await openThreeMFFromPrinter(ref);
      return;
    }
    await jobsCustomAction(api, ops, id, ref, klippy.ready, targetPrinterId());
  }

  let canPrint = $derived(klippy.ready && !printing);
  let printHint = $derived(
    !klippy.ready
      ? i18n.t('common.klipperNotReady')
      : printing
        ? i18n.t('jobs.uploadPrint.busyPrinting')
        : '',
  );
</script>

<div class="jobs-browser">
  <FileTable
    root="gcodes"
    {scope}
    mode="gcode"
    showAdd
    title={i18n.t('jobs.title')}
    {showHeaderTitle}
    {embedded}
    {printerId}
    menuItems={(ref, isDir) => jobsMenuItems(i18n, ref, isDir, klippy.ready)}
    onAction={handleAction}
    onThreeMF={handleThreeMF}
  />

  <ThreeMFInspector
    open={inspectorOpen}
    handle={inspectorHandle}
    busy={inspectorBusy}
    {canPrint}
    {printHint}
    t={i18n.t}
    onClose={() => {
      inspectorOpen = false;
      inspectorHandle = null;
    }}
    onUpload={(plateId) => void uploadPlate(plateId, false)}
    onUploadAndPrint={(plateId) => void uploadPlate(plateId, true)}
  />

  {#if inspectorError}
    <div class="error-toast" role="alert">
      <span>{inspectorError}</span>
      <button class="error-close" type="button" onclick={() => (inspectorError = '')} aria-label={i18n.t('common.close')}>×</button>
    </div>
  {/if}
</div>

<style>
  .jobs-browser {
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .error-toast {
    position: fixed;
    z-index: 400;
    inset-block-start: var(--space-md);
    inset-inline: var(--space-md);
    max-width: 560px;
    margin-inline: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    box-shadow: var(--shadow-lg);
    color: var(--danger);
    font-size: var(--font-size-sm);
  }
  .error-close {
    min-width: 44px;
    min-height: 44px;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: var(--font-size-lg);
    cursor: pointer;
  }
</style>
