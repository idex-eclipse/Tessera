<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';
  import KlippyNotReadyChip from '../shared/klippy-state/KlippyNotReadyChip.svelte';
  
  import HeaderHelp from '../shared/header-help/HeaderHelp.svelte';

  import CommandList from './CommandList.svelte';
  import ConsoleControls from './console-controls.svelte';
  import ConsoleFilterMenu from './ConsoleFilterMenu.svelte'
  import ConsoleInput from './ConsoleInput.svelte';
  import {
    attach,
    clearLines,
    getCommands,
    getHistory,
    getLines,
    getMacroParams,
    getPrefs,
    isConnected,
    pushHistory,
    sendCommand,
    applyFilters,
    compileFilters,
  } from './console-session.svelte';

  import { buildBuiltins } from './gcode-builtins';

  const api = usePluginApi();
  const i18n = api.i18n;

  attach(api);

  let printerId = $derived(api.printer.id);
  let lines = $derived(getLines(printerId));
  let connected = $derived(isConnected(printerId));
  let commands = $derived(getCommands(printerId));
  let macroParams = $derived(getMacroParams(printerId));
  let history = $derived(getHistory(printerId));
  let prefs = $derived(getPrefs(printerId));
  let builtins = $derived(buildBuiltins((k) => i18n.t(k)));
  let filterEntries = $derived(compileFilters(prefs.filters));
  let visibleLines = $derived(prefs.filtersEnabled ? applyFilters(lines, filterEntries) : lines);

  const klippy = useKlippyState(api);

  let fillTrigger = $state<{ text: string; ts: number } | null>(null);

  let inputDisabled = $derived(!connected || !klippy.ready);

  function fillFromHistory(text: string): void {
    fillTrigger = { text, ts: Date.now() };
  }

  function fillFromCommand(command: string): void {
    fillTrigger = { text: `${command} `, ts: Date.now() };
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

  function clear(): void {
    clearLines(printerId);
  }
</script>

<div class="console-page">
  <div class="console-layout">
    <div class="console-main">
      <div class="console-card">
        <div class="page-header">
          <span class="page-title">{i18n.t('console.title')}</span>
          <div class="actions">
            {#if !connected}
              <span class="console-offline">{i18n.t('console.disconnected')}</span>
            {:else}
              <KlippyNotReadyChip />
            {/if}
            <ConsoleControls />
            <ConsoleFilterMenu/>

            <button class="btn btn-secondary" onclick={clear}>{i18n.t('console.clear')}</button>

            <HeaderHelp title={i18n.t('console.help.Title')}>
              <h4>{i18n.t('console.help.AutocompleteTitle')}</h4>
              <p>{i18n.t('console.help.AutocompleteText')}</p>

              <h4>{i18n.t('console.help.ParamsTitle')}</h4>
              <p>{i18n.t('console.help.ParamsText')}</p>

              <h4>{i18n.t('console.help.HistoryTitle')}</h4>
              <p>{i18n.t('console.help.HistoryText')}</p>

              <h4>{i18n.t('console.help.ReverseTitle')}</h4>
              <p>{i18n.t('console.help.ReverseText')}</p>
            </HeaderHelp>
          </div>
        </div>

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
            {#if displayLines.length === 0}
              <p class="console-empty">
                {lines.length > 0
                  ? i18n.t('console.emptyFiltered')
                  : i18n.t('console.empty')}
              </p>
            {/if}

            {#each displayLines as line (line.id)}
              <div
                class="line line-{line.kind}"
                class:clickable={line.kind === 'sent'}
                onclick={() => line.kind === 'sent' && fillFromHistory(line.text)}
              >
                <span class="line-time">{line.time}</span>
                {#if line.kind === 'sent'}<span class="line-prefix">&gt;</span>{/if}
                <span class="line-text">{line.text}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <div class="console-sidebar">
      <CommandList
        {commands}
        {macroParams}
        {builtins}
        onCommandClick={fillFromCommand}
      />
    </div>
  </div>
</div>

<style>
  .console-page { 
    height: 100%; 
    display: flex;
  }

  .console-layout {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: var(--space-md);
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .console-main {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .console-sidebar {
    min-width: 280px;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .console-card {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .console-card .page-header { margin-bottom: 0; flex-shrink: 0; }

  .console-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    overflow: hidden;
  }

  .console-output {
    order: 1;
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    background: var(--bg-surface-hover-no-override);
    border-radius: var(--radius-sm);
    padding: var(--space-sm) var(--space-md);
    font-family: monospace;
    font-size: var(--font-size-md);
  }

  .input-slot { order: 2; flex-shrink: 0; }
  .console-body.reversed .input-slot { order: 0; }

  .console-empty { color: var(--text-muted); font-style: italic; }
  .console-offline { color: var(--danger); font-size: var(--font-size-sm); }

  .line.clickable { cursor: pointer; border-radius: var(--radius-xs); }
  .line.clickable:hover { background: var(--bg-surface-active); }

  .line { display: flex; gap: var(--space-sm); padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
  .line-time { color: var(--text-muted); flex-shrink: 0; }
  .line-prefix { color: var(--accent); font-weight: 700; }
  .line-sent .line-text { color: var(--accent); font-weight: 600; }
  .line-response .line-text { color: var(--text-primary); }
  .line-system .line-text { color: var(--text-muted); font-style: italic; }
  .line-error .line-text { color: var(--danger); }

  .btn {
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn-secondary { background: var(--bg-surface-hover-no-override); color: var(--text-primary); }
  .btn-secondary:hover { background: var(--border-color); }
</style>