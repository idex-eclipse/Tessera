<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import { segmentAtOffset } from '../../../lib/parse-gcode';
  import { ensureParsed, getEntry } from '../../../data/gcode-store.svelte';
  import { pageHash } from '../../../../shared/page-nav';
  import { usePrintProgress } from '../../../data/use-print-progress.svelte';
  import GCodeViewer from '../../shared/GCodeViewer.svelte';
  import Loader from '../../../../shared/loader/Loader.svelte';

  import { isCleared, unclear } from '../../../state/preview-ui-state.svelte';



  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const progress = usePrintProgress(api);
  let cleared = $derived(isCleared(api, 'widget'));
  let printFile = $derived(progress.filename);

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

  let entry = $derived(getEntry(api, path));

  let relViewed = $derived(path.startsWith('gcodes/') ? path.slice(7) : path);

  let progressSeg = $derived(
    entry?.status === 'ok' && progress.printing && progress.filename === relViewed
      ? segmentAtOffset(entry.parsed, progress.filePosition)
      : null,
  );

  let pageHref = $derived(
    `${pageHash(api.printer.id, 'gcode-preview')}${path ? `?file=${encodeURIComponent(path)}` : ''}`,
  );
</script>

<!-- widget-preview (replacement): the whole widget body; the header (actions) is a separate element and stays -->
<ExtensionPoint point="widget-preview">
  {#snippet original()}
    <div class="widget">
      {#if !path}
        <p class="empty">{i18n.t('gcodePreview.noPrint')}</p>
      {:else if !entry || entry.status === 'loading'}
        <Loader block text={i18n.t('gcodePreview.loading')} />
      {:else if entry.status === 'error'}
        <p class="empty error">{entry.message}</p>
      {:else}
        <GCodeViewer parsed={entry.parsed} progressSeg={progressSeg} allow3d={false} />
        <div class="widget-footer">
          <bdi class="file-name">{path.split('/').pop() ?? ''}</bdi>
          <a class="open-page" href={pageHref}>{i18n.t('gcodePreview.openPage')}</a>
        </div>
      {/if}
    </div>
  {/snippet}
</ExtensionPoint>

<style>
  .widget { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: var(--space-xs); }
  .empty { color: var(--text-muted); text-align: center; padding: var(--space-md); }
  .error { color: var(--danger); }
  .widget-footer { display: flex; align-items: center; gap: var(--space-sm); flex-shrink: 0; }
  .file-name { direction: ltr; unicode-bidi: isolate; color: var(--text-muted); font-family: monospace; font-size: var(--font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .open-page { color: var(--accent); font-size: var(--font-size-sm); text-decoration: none; white-space: nowrap; }
  .open-page:hover { text-decoration: underline; }
</style>