<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import KlippyNotReadyChip from '../../../shared/klippy-state/KlippyNotReadyChip.svelte';

  import { clearLines } from '../../console-session.svelte';
  import { useConsoleView } from '../../use-console-view.svelte';

  import ConsoleControls from '../ConsoleControls.svelte';
  import ConsoleFilterMenu from '../ConsoleFilterMenu.svelte';
  import ConsoleHelp from '../ConsoleHelp.svelte';
  import ConsoleInput from '../ConsoleInput.svelte';
  import ConsoleOutput from '../ConsoleOutput.svelte';
  import CommandList from './CommandList.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  const view = useConsoleView(api);
</script>

<div class="console-page">
  <div class="console-layout">
    <div class="console-main">
      <div class="console-card">
        <div class="page-header">
          <span class="page-title">{i18n.t('console.title')}</span>
          <div class="actions">
            {#if !view.connected}
              <span class="console-offline">{i18n.t('console.disconnected')}</span>
            {:else}
              <KlippyNotReadyChip />
            {/if}
            <ConsoleControls />
            <ConsoleFilterMenu />

            <button class="btn btn-secondary" onclick={() => clearLines(view.printerId)}>
              {i18n.t('console.clear')}
            </button>

            <ConsoleHelp />
          </div>
        </div>

        <div class="console-body" class:reversed={view.prefs.reverse}>
          <div class="input-slot">
            <ConsoleInput
              commands={view.commands}
              history={view.history}
              printerId={view.printerId}
              builtins={view.builtins}
              placeholder={i18n.t('console.placeholder')}
              above={!view.prefs.reverse}
              onSend={view.send}
              fillTrigger={view.fillTrigger}
              disabled={view.inputDisabled}
            />
          </div>

          <ConsoleOutput
            lines={view.displayLines}
            reverse={view.prefs.reverse}
            autoscroll={view.prefs.autoscroll}
            emptyText={view.lines.length > 0 ? i18n.t('console.emptyFiltered') : i18n.t('console.empty')}
            showTime
            onPick={view.fill}
          />
        </div>
      </div>
    </div>

    <div class="console-sidebar">
      <CommandList
        commands={view.commands}
        macroParams={view.macroParams}
        builtins={view.builtins}
        onCommandClick={(command) => view.fill(`${command} `)}
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

  .input-slot { order: 2; flex-shrink: 0; }
  .console-body.reversed .input-slot { order: 0; }

  .console-offline { color: var(--danger); font-size: var(--font-size-sm); }

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
