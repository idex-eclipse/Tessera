<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import { createFileOps, type FileRef } from '../shared/file-table/file-ops';
  import FileTable from '../shared/file-table/FileTable.svelte';
  import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';
  import ThreeMFInspector from '../shared/3mf-parser/3Mf-Inspector.svelte';
  import { openThreeMF } from '../shared/3mf-parser/parser';
  import type { ThreeMFHandle } from '../shared/3mf-parser/types';

  import { is3mf, jobsCustomAction, jobsMenuItems } from './jobs-menu';
  import { JOBS_PAGE_SCOPE } from './hotkeys.ts';
  import { jobsUi } from './page-ui-state.svelte.ts';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const ops = createFileOps(api);
  const klippy = useKlippyState(api);

  /** Текст ошибки: отказ гарда → перевод reasonKey плагина-гарда, иначе общий текст. */
  function reasonOf(e: unknown): string | null {
    const reasonKey = (e as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
    return reasonKey ? i18n.t(reasonKey) : null;
  }

  // ------------------------------------------------------------------
  // Состояние печати (для гейта «Печать» в инспекторе)
  // ------------------------------------------------------------------

  let printing = $state(false);

  $effect(() => {
    if (!api.printer.id) return;
    // api.moonraker() реактивен к смене принтера → эффект переподписывается сам
    return api.moonraker().subscribe(
      { print_stats: ['state'] },
      (d: any) => {
        const st = d?.print_stats?.state;
        if (typeof st === 'string') printing = st === 'printing' || st === 'paused';
      },
      { immediate: true },
    );
  });

  // ------------------------------------------------------------------
  // 3MF Inspector
  // ------------------------------------------------------------------

  let inspectorHandle = $state<ThreeMFHandle | null>(null);
  let inspectorOpen = $state(false);
  let inspectorBusy = $state(false);
  let inspectorError = $state('');

  // Пока открыт инспектор, hotkeys страницы молчат (см. hotkeys.ts)
  $effect(() => {
    jobsUi.modalOpen = inspectorOpen;
    return () => {
      jobsUi.modalOpen = false;
    };
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
      // blob с токеном авторизации (ops.readBlob), как и остальные файловые операции
      const blob = await ops.readBlob(ref);
      const name = ref.path.split('/').pop() ?? 'project.3mf';
      await handleThreeMF(new File([blob], name, { type: 'application/octet-stream' }));
    } catch {
      inspectorError = i18n.t('jobs.uploadPrint.downloadFailed');
    }
  }

  // Переход из виджета дашборда: #/p/<printer>/jobs?inspect=<путь> (читается при монтировании)
  let inspectHandled = '';
  $effect(() => {
    const path = params.inspect;
    if (!path || path === inspectHandled || !is3mf(path)) return;
    inspectHandled = path;
    void openThreeMFFromPrinter({ root: 'gcodes', path, isDir: false });
  });

  /**
   * Загрузка G-code пластины на принтер и (опционально) старт печати.
   *
   * Печать стартует отдельным `printer.print.start`, а НЕ флагом `print=true` в
   * upload: HTTP-загрузка мимо GuardAgent, а запрос проходит цепочку гардов
   * (подтверждение катушек spoolman, запрет при ручном зондировании и т.д.).
   */
  async function uploadPlate(plateId: number, print: boolean): Promise<void> {
    const handle = inspectorHandle;
    if (!handle || inspectorBusy) return;
    if (print && !canPrint) return;

    const plate = handle.inspection.plates.find((p) => p.id === plateId);
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
    } catch (e) {
      inspectorError =
        stage === 'start'
          ? (reasonOf(e) ?? i18n.t('jobs.uploadPrint.startFailed'))
          : i18n.t('jobs.uploadPrint.uploadFailed');
    } finally {
      inspectorBusy = false;
    }
  }

  // Печать .3mf из меню: скачиваем проект и открываем инспектор вместо printer.print.start
  async function wrappedOnAction(id: string, ref: FileRef): Promise<void> {
    if (id === 'print' && is3mf(ref.path)) {
      await openThreeMFFromPrinter(ref);
      return;
    }
    await jobsCustomAction(api, ops, id, ref, klippy.ready);
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

<div class="jobs-page">
  <FileTable
    root="gcodes"
    scope={JOBS_PAGE_SCOPE}
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

  <!-- ошибки 3MF-потока: инспектор — оверлей поверх страницы, поэтому плашка выше его слоя -->
  {#if inspectorError}
    <div class="error-toast" role="alert">
      <span>{inspectorError}</span>
      <button class="error-close" onclick={() => (inspectorError = '')} aria-label={i18n.t('common.close')}>×</button>
    </div>
  {/if}
</div>

<style>
  .jobs-page { height: 100%; }

  .error-toast {
    position: fixed;
    inset-block-start: var(--space-md);
    inset-inline: var(--space-md);
    margin-inline: auto;
    max-width: 560px;
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    color: var(--danger);
    font-size: var(--font-size-sm);
  }

  .error-close {
    border: none;
    background: transparent;
    color: inherit;
    font-size: var(--font-size-lg);
    line-height: 1;
    cursor: pointer;
  }
</style>
