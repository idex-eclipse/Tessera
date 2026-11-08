<script lang="ts">
  import { configComparisonRows } from '../file-table/config-diff';
  import { highlightKlipperLines, highlightPlainLines } from './highlight';

  let { before, after, lang }: {
    before: string;
    after: string;
    lang: 'klipper' | 'plain';
  } = $props();

  let rows = $derived(configComparisonRows(before, after));
  let oldHtml = $derived(lang === 'klipper' ? highlightKlipperLines(before) : highlightPlainLines(before));
  let removedLines = $derived(new Set(rows.filter((row) => row.kind === 'removed').map((row) => row.beforeLine)));
</script>

<!-- Only physical backup lines are rendered: diff placeholders cannot align with a textarea. -->
<div class="backup-lines" dir="ltr">
  {#each oldHtml as line, index (index)}
    <div class="backup-line" class:removed={removedLines.has(index + 1)}>
      <span class="number">{index + 1}</span>
      <code>{@html line}</code>
    </div>
  {/each}
</div>

<style>
  .backup-lines { padding-block: var(--space-md); min-width: max-content; }
  .backup-line { display: flex; min-height: 1.5em; white-space: pre; font-family: monospace; font-size: var(--font-size-md); line-height: 1.5; }
  .backup-line.removed { background: color-mix(in srgb, var(--danger) 18%, var(--bg-surface)); }
  .number { position: sticky; inset-inline-start: 0; flex: none; min-width: 4ch; padding-inline: var(--space-xs); text-align: end; color: var(--text-muted); background: var(--bg-surface-hover); user-select: none; }
  code { display: block; padding-inline: var(--space-sm); font: inherit; }
</style>
