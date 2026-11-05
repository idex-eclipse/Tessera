<script lang="ts">
  let { rows }: { rows: Array<{ k: string; v: string }> } = $props();
</script>

<table class="kv">
  <tbody>
    {#each rows as r (r.k)}
      <tr>
        <td class="k">{r.k}</td>
        <!-- значения — технические строки (версии, пути, ip): сами LTR, а прижаты к «началу» ячейки -->
        <td class="v"><bdi dir="ltr">{r.v}</bdi></td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .kv {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .kv td {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    vertical-align: top;
  }

  .kv tr:last-child td {
    border-bottom: none;
  }

  .kv .k {
    color: var(--text-muted);
    white-space: nowrap;
    width: 1%;
    text-align: start;
  }

  .kv .v {
    color: var(--text-primary);
    font-family: monospace;
    word-break: break-word;
    text-align: start;
  }
</style>
