<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { useConsoleView } from '../../use-console-view.svelte';

  import ConsoleInput from '../ConsoleInput.svelte';
  import ConsoleOutput from '../ConsoleOutput.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  const view = useConsoleView(api);
</script>

<div class="console-widget">
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
      emptyText={i18n.t('console.empty')}
      compact
      onPick={view.fill}
    />
  </div>
</div>

<style>
  /* контейнер: автодополнение внутри подстраивается под ширину виджета */
  :global(mpu-console-widget) {
    display: block;
    height: 100%;
    container-type: inline-size;
  }

  .console-widget {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: var(--space-sm);
  }

  .console-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .input-slot { order: 2; }
  .console-body.reversed .input-slot { order: 0; }
</style>
