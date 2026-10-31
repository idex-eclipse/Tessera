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
              catalog={view.catalog}
              objects={view.objects}
              history={view.history}
              printerId={view.printerId}
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
        catalog={view.catalog}
        onCommandClick={(command) => view.fill(`${command} `)}
      />
    </div>
  </div>
</div>

<style>
  /* Контейнер: раскладка зависит от ширины страницы, а не окна (сайдбар и правая панель
     сужают область). Узкий режим — см. @container ниже. */
  :global(mpu-console-page) {
    display: block;
    height: 100%;
    container-type: inline-size;
  }

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

  /* Узкая страница: консоль сверху (≈70%), список команд под ней (≈30%).
     Минимумы не дают частям схлопнуться на низком экране — страница тогда скроллится. */
  @container (max-width: 720px) {
    .console-layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(260px, 5fr) minmax(150px, 5fr);
    }

    .console-sidebar { min-width: 0; }

    .console-card .page-header { flex-wrap: wrap; row-gap: var(--space-xs); }
    .console-card .page-header .actions { flex-wrap: wrap; margin-inline-start: 0; }
    .console-body { padding: var(--space-sm); }
  }

  /* сенсорный указатель: кнопка «очистить» не ниже 36px */
  @media (pointer: coarse) {
    .btn { min-height: 36px; }
  }
</style>
