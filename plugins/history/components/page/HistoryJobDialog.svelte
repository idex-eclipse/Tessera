<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { formatDate, formatSize } from '../../../shared/format';
  import Icon from '../../../shared/icons/Icon.svelte';
  import Loader from '../../../shared/loader/Loader.svelte';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import {
    normalizeHistoryJob,
    useHistoryFiles,
    type HistoryJobEntry,
  } from '../../../shared/file-table/use-history-files.svelte.ts';

  import { formatDuration, formatFilament } from '../../lib/format';
  import { comparePrintEstimate, reprintBlockReason, startHistoryReprint } from '../../lib/history-analysis';
  import { loadHistoryNote, saveHistoryNote } from '../../lib/history-notes';

  let {
    jobId,
    onClose,
  }: {
    jobId: string | null;
    onClose: () => void;
  } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const klippy = useKlippyState(api);
  const history = useHistoryFiles(api);

  // The native dialog keeps focus and the backdrop inside the browser top layer.
  let dialog = $state<HTMLDialogElement | null>(null);
  let job = $state<HistoryJobEntry | null>(null);
  let printerId = $state('');
  let loading = $state(false);
  let detailError = $state('');
  let note = $state('');
  let savedNote = $state('');
  let noteExists = $state(false);
  let noteLoading = $state(false);
  let noteBusy = $state(false);
  let noteError = $state('');
  let actionBusy = $state(false);
  let actionError = $state('');
  let confirmDiscard = $state(false);
  let loadSeq = 0;

  const durationUnits = $derived({
    h: i18n.t('history.unit.h'),
    m: i18n.t('history.unit.m'),
    s: i18n.t('history.unit.s'),
  });
  const filamentUnits = $derived({
    m: i18n.t('history.unit.meter'),
    km: i18n.t('history.unit.km'),
  });
  const dirty = $derived(note !== savedNote);
  const reprintReason = $derived(job ? reprintBlockReason(job, klippy.ready, history.printing) : null);

  // Guard rejections carry a localized reason key; transport failures retain their useful message.
  function errorText(error: unknown, fallbackKey: string): string {
    const reasonKey = (error as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
    if (reasonKey) return i18n.t(reasonKey);
    return error instanceof Error && error.message ? error.message : i18n.t(fallbackKey);
  }

  // Metadata remains untrusted because slicers omit fields or emit incompatible values.
  function metadataNumber(key: string): number | null {
    const value = job?.metadata[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  // Moonraker may expose multi-value metadata as an array, JSON text, or semicolon-separated text.
  function metadataStrings(key: string): string[] {
    const value = job?.metadata[key];
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (typeof value !== 'string' || !value.trim()) return [];
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
      } catch {
        // A malformed metadata list is still useful as a plain label.
      }
    }
    return trimmed.includes(';') ? trimmed.split(';').map((item) => item.trim()).filter(Boolean) : [trimmed];
  }

  // Unknown third-party statuses stay readable instead of rendering an i18n key.
  function statusLabel(status: string): string {
    const key = `ft.status.${status.toLowerCase()}`;
    const label = i18n.t(key);
    return label === key ? status : label;
  }

  // A signed percentage makes early and late prints distinguishable at a glance.
  function estimateDelta(): string {
    const comparison = comparePrintEstimate(metadataNumber('estimated_time'), job?.printDuration);
    if (!comparison) return '—';
    const sign = comparison.delta > 0 ? '+' : comparison.delta < 0 ? '-' : '';
    return `${sign}${formatDuration(Math.abs(comparison.delta), durationUnits)} (${sign}${Math.abs(comparison.percent * 100).toFixed(1)}%)`;
  }

  // Auxiliary providers own their value shape, so objects are rendered as compact JSON.
  function auxiliaryValue(item: Record<string, unknown>): string {
    const value = item.value;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const units = typeof item.units === 'string' ? item.units : '';
    return `${text ?? '—'}${units ? ` ${units}` : ''}`;
  }

  // A sequence token prevents a late response from an old printer or selection replacing this card.
  async function loadSelectedJob(id: string, targetPrinterId: string, reloadNote = true): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    detailError = '';
    noteError = '';
    try {
      const response = await api.moonrakerFor(targetPrinterId).request<{ job?: Record<string, unknown> }>(
        'server.history.get_job',
        { uid: id },
      );
      if (seq !== loadSeq || jobId !== id || api.printer.id !== targetPrinterId) return;
      const normalized = response.job ? normalizeHistoryJob(response.job) : null;
      if (!normalized) throw new Error(i18n.t('history.detail.loadFailed'));
      job = normalized;
      if (!reloadNote) return;
      noteLoading = true;
      try {
        const loaded = await loadHistoryNote(api.moonrakerFor(targetPrinterId), id, normalized.startTime);
        if (seq !== loadSeq || jobId !== id || api.printer.id !== targetPrinterId) return;
        note = loaded.text;
        savedNote = loaded.text;
        noteExists = loaded.exists;
      } catch (error) {
        if (seq === loadSeq) noteError = errorText(error, 'history.detail.noteLoadFailed');
      } finally {
        if (seq === loadSeq) noteLoading = false;
      }
    } catch (error) {
      if (seq === loadSeq) detailError = errorText(error, 'history.detail.loadFailed');
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  // Each selected job starts with isolated action and note state.
  function resetSession(): void {
    job = null;
    loading = false;
    detailError = '';
    note = '';
    savedNote = '';
    noteExists = false;
    noteLoading = false;
    noteBusy = false;
    noteError = '';
    actionBusy = false;
    actionError = '';
    confirmDiscard = false;
  }

  // History notifications refresh immutable job facts without discarding an edited note.
  $effect(() => {
    const id = jobId;
    const element = dialog;
    if (!element) return;
    if (!id) {
      loadSeq++;
      resetSession();
      if (element.open) element.close();
      return;
    }

    printerId = api.printer.id;
    resetSession();
    if (!element.open) element.showModal();
    void loadSelectedJob(id, printerId);
    const off = api.moonrakerFor(printerId).onNotify('notify_history_changed', () => {
      // An unrelated history event may arrive while the user edits a note; refresh job facts only.
      if (!loading && jobId === id && api.printer.id === printerId) void loadSelectedJob(id, printerId, false);
    });
    return off;
  });

  // Unsaved notes are confirmed inside the card so the modal never disappears unexpectedly.
  function requestClose(): void {
    if (dirty && !confirmDiscard) {
      confirmDiscard = true;
      return;
    }
    onClose();
  }

  // Empty text intentionally removes the database record through the note helper.
  async function saveNote(): Promise<void> {
    if (!job || noteBusy) return;
    noteBusy = true;
    noteError = '';
    try {
      const saved = await saveHistoryNote(
        api.moonrakerFor(printerId),
        job.jobId,
        job.startTime,
        note,
        noteExists,
      );
      note = saved.text;
      savedNote = saved.text;
      noteExists = saved.exists;
      confirmDiscard = false;
    } catch (error) {
      noteError = errorText(error, 'history.detail.noteSaveFailed');
    } finally {
      noteBusy = false;
    }
  }

  // The ordinary proxy request preserves the complete guard chain for print starts.
  async function reprint(): Promise<void> {
    if (!job || reprintReason || actionBusy) return;
    actionBusy = true;
    actionError = '';
    try {
      await startHistoryReprint(api.moonrakerFor(printerId), job);
      onClose();
    } catch (error) {
      actionError = errorText(error, 'history.detail.reprintFailed');
    } finally {
      actionBusy = false;
    }
  }

  // Disabled actions always explain which live safety condition is not satisfied.
  function reprintHint(): string {
    if (reprintReason === 'file') return i18n.t('history.detail.reprintFileChanged');
    if (reprintReason === 'klippy') return i18n.t('common.klipperNotReady');
    if (reprintReason === 'printing') return i18n.t('history.detail.reprintPrinting');
    return '';
  }
</script>

<dialog
  class="job-dialog"
  bind:this={dialog}
  aria-labelledby="history-job-title"
  oncancel={(event) => { event.preventDefault(); requestClose(); }}
  onclick={(event) => { if (event.target === dialog) requestClose(); }}
>
  <div class="dialog-shell">
    <header class="dialog-header">
      <div class="title-wrap">
        <h2 id="history-job-title">{i18n.t('history.detail.title')}</h2>
        {#if job}<bdi class="filename">{job.filename}</bdi>{/if}
      </div>
      <button class="icon-button" aria-label={i18n.t('common.close')} title={i18n.t('common.close')} onclick={requestClose}>
        <Icon name="x" size={20} />
      </button>
    </header>

    {#if confirmDiscard}
      <div class="discard" role="alert">
        <h3>{i18n.t('history.detail.discardTitle')}</h3>
        <p>{i18n.t('history.detail.discardBody')}</p>
        <div class="discard-actions">
          <button class="btn secondary" onclick={() => (confirmDiscard = false)}>{i18n.t('common.cancel')}</button>
          <button class="btn danger" onclick={onClose}>{i18n.t('history.detail.discard')}</button>
        </div>
      </div>
    {:else if loading && !job}
      <div class="state"><Loader text={i18n.t('ft.loading')} /></div>
    {:else if detailError || !job}
      <div class="state error" role="alert">
        <Icon name="warning" size={22} />
        <span>{detailError || i18n.t('history.detail.loadFailed')}</span>
        {#if jobId}<button class="btn secondary" onclick={() => void loadSelectedJob(jobId!, printerId)}>{i18n.t('ft.retry')}</button>{/if}
      </div>
    {:else}
      <div class="dialog-body">
        <section class="summary" aria-label={i18n.t('history.detail.summary')}>
          <span class="status status-{job.status.toLowerCase().replace(/[^a-z0-9_]/g, '-')}">{statusLabel(job.status)}</span>
          <dl class="facts">
            <div><dt>{i18n.t('history.detail.started')}</dt><dd>{formatDate(job.startTime)}</dd></div>
            <div><dt>{i18n.t('history.detail.finished')}</dt><dd>{job.endTime ? formatDate(job.endTime) : '—'}</dd></div>
            <div><dt>{i18n.t('history.detail.user')}</dt><dd>{job.user || '—'}</dd></div>
            <div><dt>{i18n.t('history.detail.fileState')}</dt><dd>{job.exists ? i18n.t('history.detail.fileUnchanged') : i18n.t('history.detail.fileChanged')}</dd></div>
          </dl>
        </section>

        <section class="card comparison">
          <h3>{i18n.t('history.detail.timeComparison')}</h3>
          <dl class="facts three">
            <div><dt>{i18n.t('history.detail.estimated')}</dt><dd>{formatDuration(metadataNumber('estimated_time') ?? undefined, durationUnits)}</dd></div>
            <div><dt>{i18n.t('history.detail.actual')}</dt><dd>{formatDuration(job.printDuration, durationUnits)}</dd></div>
            <div><dt>{i18n.t('history.detail.difference')}</dt><dd>{estimateDelta()}</dd></div>
            <div><dt>{i18n.t('history.detail.totalElapsed')}</dt><dd>{formatDuration(job.totalDuration, durationUnits)}</dd></div>
          </dl>
        </section>

        <div class="details-grid">
          <section class="card">
            <h3>{i18n.t('history.detail.fileMetadata')}</h3>
            <dl class="facts">
              <div><dt>{i18n.t('history.detail.fileSize')}</dt><dd>{job.size > 0 ? formatSize(job.size) : '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.slicer')}</dt><dd>{metadataStrings('slicer')[0] ?? '—'}{#if metadataStrings('slicer_version')[0]} {metadataStrings('slicer_version')[0]}{/if}</dd></div>
              <div><dt>{i18n.t('history.detail.layerHeight')}</dt><dd>{metadataNumber('layer_height') != null ? `${metadataNumber('layer_height')} mm` : '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.firstLayerHeight')}</dt><dd>{metadataNumber('first_layer_height') != null ? `${metadataNumber('first_layer_height')} mm` : '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.layerCount')}</dt><dd>{metadataNumber('layer_count') ?? '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.objectHeight')}</dt><dd>{metadataNumber('object_height') != null ? `${metadataNumber('object_height')} mm` : '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.nozzle')}</dt><dd>{metadataNumber('nozzle_diameter') != null ? `${metadataNumber('nozzle_diameter')} mm` : '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.extruderTemp')}</dt><dd>{metadataNumber('first_layer_extruder_temp') != null ? `${metadataNumber('first_layer_extruder_temp')} °C` : '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.bedTemp')}</dt><dd>{metadataNumber('first_layer_bed_temp') != null ? `${metadataNumber('first_layer_bed_temp')} °C` : '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.chamberTemp')}</dt><dd>{metadataNumber('chamber_temp') != null ? `${metadataNumber('chamber_temp')} °C` : '—'}</dd></div>
            </dl>
          </section>

          <section class="card">
            <h3>{i18n.t('history.detail.material')}</h3>
            <dl class="facts">
              <div><dt>{i18n.t('history.detail.filamentName')}</dt><dd>{metadataStrings('filament_name').join(', ') || '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.filamentType')}</dt><dd>{metadataStrings('filament_type').join(', ') || '—'}</dd></div>
              <div><dt>{i18n.t('history.detail.filamentUsed')}</dt><dd>{formatFilament(job.filamentUsed, filamentUnits)}</dd></div>
              <div><dt>{i18n.t('history.detail.filamentWeight')}</dt><dd>{metadataNumber('filament_weight_total') != null ? `${metadataNumber('filament_weight_total')!.toFixed(1)} g` : '—'}</dd></div>
            </dl>
          </section>
        </div>

        {#if job.auxiliaryData.length > 0}
          <section class="card">
            <h3>{i18n.t('history.detail.auxiliary')}</h3>
            <dl class="facts">
              {#each job.auxiliaryData as item, index (`${String(item.provider)}-${String(item.name)}-${index}`)}
                <div>
                  <dt>{typeof item.description === 'string' ? item.description : String(item.name ?? item.provider ?? '—')}</dt>
                  <dd>{auxiliaryValue(item)}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/if}

        <section class="card note-card">
          <label for="history-note">{i18n.t('history.detail.note')}</label>
          {#if noteLoading}<Loader size="sm" text={i18n.t('history.detail.noteLoading')} inline />{/if}
          <textarea id="history-note" bind:value={note} disabled={noteLoading || noteBusy} placeholder={i18n.t('history.detail.notePlaceholder')}></textarea>
          {#if noteError}<p class="inline-error" role="alert">{noteError}</p>{/if}
          <div class="note-actions">
            <button class="btn secondary" disabled={!dirty || noteLoading || noteBusy} onclick={() => void saveNote()}>
              <Icon name="save" size={16} />
              {noteBusy ? i18n.t('history.detail.saving') : i18n.t('history.detail.saveNote')}
            </button>
          </div>
        </section>

        {#if actionError}<p class="inline-error action-error" role="alert">{actionError}</p>{/if}
      </div>

      <footer class="dialog-footer">
        <span class="reprint-hint">{reprintHint()}</span>
        <button class="btn secondary" onclick={requestClose}>{i18n.t('common.close')}</button>
        <button class="btn primary" disabled={Boolean(reprintReason) || actionBusy} onclick={() => void reprint()}>
          <Icon name="print" size={17} />
          {actionBusy ? i18n.t('history.detail.starting') : i18n.t('history.detail.reprint')}
        </button>
      </footer>
    {/if}
  </div>
</dialog>

<style>
  .job-dialog {
    position: fixed;
    inset: 0;
    margin: auto;
    width: min(900px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100dvh - 32px);
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .job-dialog::backdrop { background: var(--bg-overlay); }
  .dialog-shell { display: flex; flex-direction: column; max-height: calc(100dvh - 32px); min-height: 260px; }
  .dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color); }
  .title-wrap { min-width: 0; display: grid; gap: var(--space-xs); }
  h2, h3, p { margin: 0; }
  h2 { font-size: var(--font-size-lg); }
  h3 { font-size: var(--font-size-md); }
  /* File paths are inherently LTR and must not reorder inside an RTL heading. */
  .filename { direction: ltr; unicode-bidi: isolate; overflow-wrap: anywhere; color: var(--text-secondary); font-family: monospace; }
  .icon-button { display: grid; place-items: center; flex: 0 0 40px; width: 40px; height: 40px; border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-muted); cursor: pointer; }
  .icon-button:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .dialog-body { min-height: 0; overflow-y: auto; padding: var(--space-lg); display: grid; gap: var(--space-md); }
  .summary { display: grid; gap: var(--space-md); }
  .status { justify-self: start; padding: 3px 10px; border-radius: 999px; background: var(--bg-surface-hover); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: 600; }
  .status-completed, .status-complete { color: var(--success); }
  .status-cancelled, .status-error, .status-klippy_shutdown, .status-klippy_disconnect, .status-interrupted, .status-server_exit { color: var(--danger); }
  .card { min-width: 0; padding: var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface-hover-no-override); display: grid; gap: var(--space-md); }
  .details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-md); }
  .facts { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-sm) var(--space-md); }
  .facts.three { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .facts div { min-width: 0; }
  dt { color: var(--text-muted); font-size: var(--font-size-sm); }
  dd { margin: 2px 0 0; overflow-wrap: anywhere; unicode-bidi: isolate; }
  .note-card label { font-weight: 600; }
  textarea { width: 100%; min-height: 110px; resize: vertical; padding: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); font: inherit; line-height: 1.45; }
  textarea:focus { outline: none; border-color: var(--border-focus); }
  .note-actions { display: flex; justify-content: flex-end; }
  .inline-error { color: var(--danger); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
  .action-error { padding-inline: var(--space-xs); }
  .dialog-footer { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border-color); }
  .reprint-hint { margin-inline-end: auto; color: var(--text-muted); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
  .btn { min-height: 40px; padding: var(--space-sm) var(--space-md); border: none; border-radius: var(--radius-md); display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs); color: var(--text-primary); font: inherit; cursor: pointer; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn.secondary { background: var(--bg-surface-hover); }
  .btn.primary { background: var(--accent); color: var(--accent-text); }
  .btn.danger { background: var(--danger); color: var(--accent-text); }
  .state, .discard { flex: 1; min-height: 220px; padding: var(--space-xl); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-md); text-align: center; }
  .state.error { color: var(--danger); }
  .discard-actions { display: flex; gap: var(--space-sm); }

  /* A single-column sheet keeps all controls reachable without horizontal scrolling on narrow screens. */
  @media (max-width: 768px) {
    .job-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
    .dialog-shell { max-height: calc(100dvh - 16px); }
    .dialog-header, .dialog-body, .dialog-footer { padding-inline: var(--space-md); }
    .details-grid, .facts, .facts.three { grid-template-columns: 1fr; }
    .dialog-footer { align-items: stretch; flex-wrap: wrap; }
    .reprint-hint { flex: 1 0 100%; margin-inline-end: 0; }
    .dialog-footer .btn { flex: 1 1 140px; }
  }
</style>
