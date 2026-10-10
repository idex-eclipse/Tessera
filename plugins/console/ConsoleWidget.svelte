<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';

  import ConsoleInput from './ConsoleInput.svelte';
  import {
    attach,
    getCommands,
    getHistory,
    getLines,
    getPrefs,
    isConnected,
    pushHistory,
    sendCommand,
    applyFilters,
    compileFilters,
  } from './console-session.svelte';

  import { buildBuiltins } from './gcode-builtins';

  let builtins = $derived(buildBuiltins((k) => i18n.t(k)));

  const api = usePluginApi();
  const i18n = api.i18n;

  attach(api);

  let printerId = $derived(api.printer.id);
  let lines = $derived(getLines(printerId));
  let connected = $derived(isConnected(printerId));
  let commands = $derived(getCommands(printerId));
  let history = $derived(getHistory(printerId));
  let prefs = $derived(getPrefs(printerId));
  let filterEntries = $derived(compileFilters(prefs.filters));
  let visibleLines = $derived(prefs.filtersEnabled ? applyFilters(lines, filterEntries) : lines);

  const klippy = useKlippyState(api);

  let fillTrigger = $state<{ text: string; ts: number } | null>(null);

  let inputDisabled = $derived(!connected || !klippy.ready);

  function fillFromHistory(text: string): void {
    fillTrigger = { text, ts: Date.now() };
  }

  let displayLines = $derived.by(() => (prefs.reverse ? [...visibleLines].reverse() : visibleLines));

  let outputEl = $state<HTMLElement | null>(null);

  $effect(() => {
    void displayLines;
    void prefs.autoscroll;
    void prefs.reverse;
    if (!outputEl || !prefs.autoscroll) return;
    outputEl.scrollTop = prefs.reverse ? 0 : outputEl.scrollHeight;
  });

  function handleSend(script: string): void {
    pushHistory(api, printerId, script);
    void sendCommand(api, printerId, script);
  }

</script>

<div class="console-widget">
  <div class="console-body" class:reversed={prefs.reverse}>
    <div class="input-slot">
      <ConsoleInput
        {commands}
        {history}
        {printerId}
        {builtins}
        placeholder={i18n.t('console.placeholder')}
        above={!prefs.reverse}
        onSend={handleSend}
        {fillTrigger}
        disabled={inputDisabled}
      />
    </div>

    <div class="console-output" bind:this={outputEl}>
      {#each displayLines as line (line.id)}
        <div
          class="wline wline-{line.kind}"
          class:clickable={line.kind === 'sent'}
          onclick={() => line.kind === 'sent' && fillFromHistory(line.text)}
        >
          {#if line.kind === 'sent'}<span class="wline-prefix">&gt;</span>{/if}
          <span class="wline-text">{line.text}</span>
        </div>
      {:else}
        <p class="wline-empty">{i18n.t('console.empty')}</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .console-widget {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: var(--space-sm);
  }

  .console-widget-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .ctl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
  }

  .ctl:hover { background: var(--bg-surface-hover); color: var(--text-primary); }

  .console-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .console-output {
    order: 1;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--bg-surface-hover-no-override);
    border-radius: var(--radius-sm);
    padding: var(--space-xs) var(--space-sm);
    font-family: monospace;
    font-size: var(--font-size-sm);
  }

  .input-slot { order: 2; }
  .console-body.reversed .input-slot { order: 0; }

  .wline { display: flex; gap: var(--space-xs); padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
  .wline-prefix { color: var(--accent); font-weight: 700; flex-shrink: 0; }
  .wline-sent .wline-text { color: var(--accent); font-weight: 600; }
  .wline-response .wline-text { color: var(--text-primary); }
  .wline-system .wline-text { color: var(--text-muted); font-style: italic; }
  .wline-error .wline-text { color: var(--danger); }
  .wline-empty { color: var(--text-muted); font-style: italic; }
  .wline.clickable { cursor: pointer; border-radius: var(--radius-xs); }
  .wline.clickable:hover { background: var(--bg-surface-active); }
</style>