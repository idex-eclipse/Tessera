<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';

  import { useWidget, useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import { useHealth } from '../../data/use-health.svelte.ts';
  import type { Severity } from '../../lib/health-utils';
  import { collectHealthIssues, countCritical, type HealthIssue } from '../../lib/health-issues';
  import { pageHash } from '../../../shared/page-nav';
  import { placeChipPopover } from '../../../shared/popover-align.ts';
  import StatusChip from '../page/panels/health/StatusChip.svelte';

  let {
    mpuApi,
    mpuParams,
    params,
  }: {
    mpuApi?: PluginApi;
    mpuParams?: Record<string, string>;
    params?: Record<string, string>;
  } = $props();

  const ctxApi = useWidget();
  const api = mpuApi ?? ctxApi;
  const i18n = useI18n();

  const injected = mpuParams ?? params;
  const printerId = injected?.printerId ?? api.printer.id;

  if (!injected?.printerId) {
    console.warn(
      '[fleet-health] printerId NOT injected — fallback to active printer.',
    );
  }

  const health = useHealth(api, printerId);

  let issues = $derived(
    collectHealthIssues({
      klippyReady: health.klippyReady,
      throttle: health.throttle,
      cpuTemp: health.cpuTemp,
      failedComponents: health.failedComponents,
      warnings: health.warnings,
      mcus: health.mcus,
      tmc: health.tmc,
    }),
  );

  // Итоговая окраска: худшая из известных проблем; без проблем — зелёный только при готовом
  // Klipper, иначе серый «нет данных»: зелёное «OK» при лежащем Klipper вводило бы в заблуждение.
  let worst = $derived.by<Severity>(() => {
    if (issues.length > 0) return issues.some((i) => i.severity === 'crit') ? 'crit' : 'warn';
    return health.klippyReady ? 'ok' : 'unknown';
  });

  // «Всё ок» в popover честно только при готовом Klipper; иначе данные MCU/драйверов устарели.
  let allOk = $derived(issues.length === 0 && health.klippyReady);

  // Группировка для popover: хост → MCU → драйверы; порядок групп фиксирован.
  const SCOPES = ['host', 'mcu', 'tmc'] as const;
  const scopeLabel: Record<(typeof SCOPES)[number], string> = {
    host: 'system.health.host',
    mcu: 'system.health.mcu',
    tmc: 'system.health.drivers',
  };
  let grouped = $derived(
    SCOPES.map((scope) => ({
      scope,
      issues: issues.filter((i) => i.scope === scope),
    })).filter((g) => g.issues.length > 0),
  );

  /** Динамические ключи (состояния шины) могут не иметь перевода — тогда показываем сырое значение. */
  function issueText(issue: HealthIssue): string {
    const t = i18n.t(issue.textKey, issue.params ?? {});
    return t === issue.textKey && issue.scope === 'mcu' && issue.textKey.startsWith('system.link.bus.')
      ? issue.textKey.slice('system.link.bus.'.length)
      : t;
  }

  let indicatorTitle = $derived.by(() => {
    if (issues.length === 0) {
      return allOk ? i18n.t('fleet.health.ok') : i18n.t('system.health.state.unknown');
    }
    return i18n.t('fleet.health.issuesTooltip', {
      state: i18n.t(`system.health.state.${worst}`),
      count: issues.length,
      crit: countCritical(issues),
    });
  });

  // ---------- popover (паттерн LiveZChip) ----------

  const POPOVER_WIDTH = 280;
  let btnEl = $state<HTMLButtonElement | null>(null);
  let popoverOpen = $state(false);
  let popoverStyle = $state('');

  function openPopover(): void {
    const rect = btnEl?.getBoundingClientRect();
    if (rect) {
      // Поповер растёт от начальной стороны кнопки; при нехватке места переключается на конечную (RTL-aware).
      popoverStyle = placeChipPopover(rect, { width: POPOVER_WIDTH, height: 240 });
    }
    popoverOpen = true;
  }
  function closePopover(): void { popoverOpen = false; }

  /** Переход на Machine → Мониторинг этого принтера; смена hash закрывает fleet-режим сама. */
  function openMonitoring(): void {
    closePopover();
    if (!printerId) return;
    globalThis.location.hash = `${pageHash(printerId, 'machine')}?section=monitoring`;
  }
</script>

<div class="fh-root">
  <button
    type="button"
    class="fh-indicator"
    class:open={popoverOpen}
    bind:this={btnEl}
    onclick={openPopover}
    title={indicatorTitle}
    aria-label={indicatorTitle}
    aria-expanded={popoverOpen}
  >
    <StatusChip severity={worst} label={i18n.t(`system.health.state.${worst}`)} borderless size="md" />
  </button>

  {#if popoverOpen}
    <div class="fh-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="fh-popover" style={popoverStyle} role="dialog" aria-label={i18n.t('fleet.health.title')}>
      <h3 class="fh-title">{i18n.t('fleet.health.title')}</h3>

      {#if allOk}
        <p class="fh-ok">{i18n.t('fleet.health.ok')}</p>
      {:else if issues.length === 0}
        <p class="fh-unknown">{i18n.t('system.health.state.unknown')}</p>
      {:else}
        <!-- max-height + скролл: список проблем не должен уезжать за пределы вьюпорта -->
        <div class="fh-list">
          {#each grouped as g (g.scope)}
            <div class="fh-group">
              <span class="fh-group-name">{i18n.t(scopeLabel[g.scope])}</span>
              <ul>
                {#each g.issues as issue (`${issue.scope}:${issue.target}:${issue.textKey}`)}
                  <li class="fh-issue" class:crit={issue.severity === 'crit'}>
                    <span class="fh-dot" aria-hidden="true"></span>
                    <span class="fh-text">
                      {#if issue.target}<bdi class="fh-target">{issue.target}</bdi>: {/if}{issueText(issue)}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}

      <button type="button" class="fh-open" onclick={openMonitoring}>
        {i18n.t('fleet.health.openMonitoring')}
      </button>
    </div>
  {/if}
</div>

<style>
  .fh-root {
    position: relative;
    height: 100%;
    display: flex;
  }

  /* Растяжение на всю ячейку сетки — как у панелей Jobs / Job Queue (fleet-action-button). */
  .fh-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 44px;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .fh-indicator:hover,
  .fh-indicator.open {
    background: var(--bg-surface-hover);
    border-color: var(--border-focus);
  }

  .fh-indicator:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .fh-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .fh-popover {
    position: fixed;
    z-index: 1001;
    width: min(280px, calc(100vw - 16px));
    max-height: min(400px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .fh-title {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .fh-ok {
    margin: 0;
    color: var(--success);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .fh-unknown {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .fh-list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-height: 0;
  }

  .fh-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fh-group-name {
    font-size: var(--font-size-2xs, var(--font-size-xs));
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-muted);
  }

  .fh-group ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fh-issue {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--warning);
    min-width: 0;
  }

  .fh-issue.crit {
    color: var(--danger);
  }

  .fh-dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    transform: translateY(-1px);
  }

  /* long localized texts wrap instead of clipping — narrow fleet cards and mobile */
  .fh-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .fh-target {
    font-family: monospace;
    font-weight: 600;
  }

  .fh-open {
    flex-shrink: 0;
    min-height: var(--touch-target, 36px);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--accent);
    font-size: var(--font-size-sm);
    font-weight: 600;
    cursor: pointer;
  }

  .fh-open:hover {
    background: var(--bg-surface-active);
  }
</style>
