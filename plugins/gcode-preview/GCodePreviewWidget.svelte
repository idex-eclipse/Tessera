<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import { segmentAtOffset } from './viewer/parse-gcode';
  import { ensureParsed, getEntry } from './viewer/gcode-store.svelte';
  import { usePrintProgress } from './viewer/use-print-progress.svelte';
  import GCodeViewer from './viewer/GCodeViewer.svelte';

  import { isCleared, unclear } from './viewer/preview-ui-state.svelte';



  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const progress = usePrintProgress(api);
  let cleared = $derived(isCleared(api, 'widget'));
  let printFile = $state('');

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
    if (params.preview) unclear(api, 'widget');
  });

  let path = $derived(
    !cleared && params.preview
        ? params.preview
        : !cleared && printFile
        ? `gcodes/${printFile}`
        : '',
  );

  $effect(() => {
    ensureParsed(api, path);
  });

  let entry = $derived(getEntry(path));

  let relViewed = $derived(path.startsWith('gcodes/') ? path.slice(7) : path);

  let progressSeg = $derived(
    entry?.status === 'ok' && progress.printing && progress.filename === relViewed
      ? segmentAtOffset(entry.parsed, progress.filePosition)
      : null,
  );

  let pageHref = $derived(
    `#/p/${api.printer.id}/gcode-preview${path ? `?file=${encodeURIComponent(path)}` : ''}`,
  );
</script>

<div class="widget">
  {#if !path}
    <p class="empty">{i18n.t('gcodePreview.noPrint')}</p>
  {:else if !entry || entry.status === 'loading'}
    <p class="empty">{i18n.t('gcodePreview.loading')}</p>
  {:else if entry.status === 'error'}
    <p class="empty error">{entry.message}</p>
  {:else}
    <GCodeViewer parsed={entry.parsed} progressSeg={progressSeg} allow3d={false} />
    <div class="widget-footer">
      <span class="file-name">{path.split('/').pop() ?? ''}</span>
      <a class="open-page" href={pageHref}>{i18n.t('gcodePreview.openPage')}</a>
    </div>
  {/if}
</div>

<style>
  .widget { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: var(--space-xs); }
  .empty { color: var(--text-muted); text-align: center; padding: var(--space-md); }
  .error { color: var(--danger); }
  .widget-footer { display: flex; align-items: center; gap: var(--space-sm); flex-shrink: 0; }
  .file-name { color: var(--text-muted); font-family: monospace; font-size: var(--font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .open-page { color: var(--accent); font-size: var(--font-size-sm); text-decoration: none; white-space: nowrap; }
  .open-page:hover { text-decoration: underline; }
</style>