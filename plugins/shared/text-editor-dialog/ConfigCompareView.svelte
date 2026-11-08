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
</script>

<!-- The backup is read-only; the existing editor textarea stays mounted beside it. -->
<div class="backup-lines" dir="ltr">
  {#each rows as row, index (index)}
    <div class="backup-line" class:removed={row.kind === 'removed'}>
      <span class="number">{row.beforeLine ?? ''}</span>
      <code>{#if row.beforeLine !== null}{@html oldHtml[row.beforeLine - 1] ?? ''}{:else}&nbsp;{/if}</code>
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
