<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import GCodeViewer from './viewer/GCodeViewer.svelte';
  import { ensureParsed, getEntry } from './viewer/gcode-store.svelte';

  import { usePrintProgress } from './viewer/use-print-progress.svelte';
  import { segmentAtOffset } from './viewer/parse-gcode';

  import { isCleared, unclear, clearPreview } from './viewer/preview-ui-state.svelte';
  import Icon from '../shared/icons/Icon.svelte';
  import HeaderHelp from '../shared/header-help/HeaderHelp.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  let { params = {} }: { params?: Record<string, string> } = $props();
  let printFile = $state('');
  let cleared = $derived(isCleared(api, 'page'));
  let path = $derived(
    !cleared && params.file
      ? params.file
      : !cleared && printFile
        ? `gcodes/${printFile}`
        : '',
  );
  let fileName = $derived(path.split('/').pop() ?? '');
  let entry = $derived(getEntry(path));

  const progress = usePrintProgress(api);



  let relViewed = $derived(path.startsWith('gcodes/') ? path.slice(7) : path);

  let progressSeg = $derived(
    entry?.status === 'ok' && progress.printing && progress.filename === relViewed
      ? segmentAtOffset(entry.parsed, progress.filePosition)
      : null,
  );

  $effect(() => {
    if (params.file) unclear(api, 'page');
  });

  $effect(() => {
    return api.moonraker().subscribe(
      { print_stats: ['filename'] },
      (d: any) => {
        const fn = d?.print_stats?.filename;
        if (typeof fn === 'string') printFile = fn;
      },
      { immediate: true },
    );
  });

  $effect(() => {
    ensureParsed(api, path);
  });
</script>

<div class="preview-page">
  <div class="preview-card">
    <div class="page-header">
      <span class="page-title">{i18n.t('gcodePreview.title')}</span>
      {#if fileName}
        <span class="file-name">{fileName}</span>
        <button
          class="clear-btn"
          title={i18n.t('gcodePreview.clear')}
          onclick={() => clearPreview(api, 'page')}
        >
          <Icon name="x" size={14} />
        </button>
      {/if}
      <HeaderHelp title={i18n.t('gcodePreview.help.Title')}>
        <h4>{i18n.t('gcodePreview.help.FollowTitle')}</h4>
        <p>{i18n.t('gcodePreview.help.FollowText')}</p>

        <h4>{i18n.t('gcodePreview.help.LayersTitle')}</h4>
        <p>{i18n.t('gcodePreview.help.LayersText')}</p>

        <h4>{i18n.t('gcodePreview.help.ColorsTitle')}</h4>
        <p>{i18n.t('gcodePreview.help.ColorsText')}</p>

        <h4>{i18n.t('gcodePreview.help.ExcludeTitle')}</h4>
        <p>{i18n.t('gcodePreview.help.ExcludeText')}</p>
      </HeaderHelp>
    </div>

    <div class="preview-body">
      {#if !path}
        <p class="empty">{i18n.t('gcodePreview.noFile')}</p>
        <p class="empty-hint">{i18n.t('gcodePreview.noFileHint')}</p>
      {:else if !entry || entry.status === 'loading'}
        <p class="empty">{i18n.t('gcodePreview.loading')}</p>
      {:else if entry.status === 'error'}
        <p class="error">{entry.message}</p>
      {:else}
        <GCodeViewer parsed={entry.parsed} progressSeg={progressSeg} />
      {/if}
    </div>
  </div>
</div>

<style>
  .preview-page { height: 100%; }
  .preview-card { display: flex; flex-direction: column; height: 100%; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); overflow: hidden; }
  .preview-card .page-header { margin-bottom: 0; }
  .file-name { color: var(--text-muted); font-family: monospace; font-size: var(--font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preview-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: var(--space-md); }
  .empty { color: var(--text-muted); text-align: center; padding: var(--space-lg); }
  .empty-hint { color: var(--text-muted); font-size: var(--font-size-sm); text-align: center; }
  .error { color: var(--danger); }

  .clear-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .clear-btn:hover { background: var(--bg-surface-hover); color: var(--danger); }
</style>