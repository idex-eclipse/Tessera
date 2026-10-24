<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import type { MacroParam } from '../../../shared/macro-params';
  import type { BuiltinHelp } from '../../gcode-builtins';

  interface Props {
    commands: Record<string, string>;
    macroParams: Record<string, MacroParam[]>;
    builtins: Record<string, BuiltinHelp>;
    onCommandClick: (command: string) => void;
  }

  let { commands, macroParams, builtins, onCommandClick }: Props = $props();

  const api = usePluginApi();
  const i18n = api.i18n;

  interface ParamChip {
    name: string;
    type?: string;
  }

  interface CommandEntry {
    name: string;
    help: string;
    params: ParamChip[];
  }

  let entries = $derived.by<CommandEntry[]>(() => {
    const names = Array.from(
      new Set([...Object.keys(commands), ...Object.keys(builtins)]),
    ).sort();

    return names.map((name) => {
      const builtin = builtins[name];
      const macro = macroParams[name];

      // приоритет как в автодополнении: макрос-параметры с типами,
      // иначе сигнатура builtin без типов
      const params: ParamChip[] = macro
        ? macro.map((p) => ({ name: p.name, type: p.type }))
        : builtin?.params
          ? builtin.params.split(/\s+/).filter(Boolean).map((n) => ({ name: n }))
          : [];

      return {
        name,
        help: commands[name] ?? builtin?.help ?? '',
        params,
      };
    });
  });
</script>

<div class="command-list">
  <h3 class="command-list-title">{i18n.t('console.commandList')}</h3>

  {#if entries.length === 0}
    <p class="command-empty">{i18n.t('console.commandListEmpty')}</p>
  {:else}
    <div class="command-list-grid">
      {#each entries as entry (entry.name)}
        <button
          class="command-item"
          onclick={() => onCommandClick(entry.name)}
          title={entry.help || entry.name}
        >
          <span class="cmd-head">
            <span class="cmd-name">{entry.name}</span>
            {#if entry.help}
              <span class="cmd-help">{entry.help}</span>
            {/if}
          </span>

          {#if entry.params.length > 0}
            <span class="cmd-params">
              {#each entry.params as param (param.name)}
                <span class="param-chip">
                  <span class="param-name">{param.name}</span>
                  {#if param.type}
                    <span class="param-type">{param.type}</span>
                  {/if}
                </span>
              {/each}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .command-list {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    padding: var(--space-sm);
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .command-list-title {
    flex-shrink: 0;
    margin: 0 0 var(--space-sm) 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .command-empty {
    color: var(--text-muted);
    font-style: italic;
    font-size: var(--font-size-sm);
  }

  .command-list-grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    gap: var(--space-xs);
    align-items: start;
    align-content: start;
  }

  .command-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface-hover-no-override);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-sm);
    text-align: start;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .command-item:hover {
    background: var(--bg-surface-active);
    border-color: var(--accent);
  }

  .command-item:hover .cmd-name { color: var(--accent); }

  .cmd-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-xs);
    min-width: 0;
  }

  .cmd-name {
    font-weight: 700;
    color: var(--accent);
    word-break: break-all;
  }

  .cmd-help {
    color: var(--text-muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cmd-params {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .param-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 1px var(--space-xs);
    background: var(--bg-surface-active);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs, 11px);
    white-space: nowrap;
  }

  .param-name { font-weight: 700; color: var(--text-primary); }
  .param-type { color: var(--text-muted); }
</style>