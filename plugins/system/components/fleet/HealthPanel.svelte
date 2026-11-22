<script lang="ts">
  import type { ExtensionRef, PluginApi } from '../../../../plugin-sdk/src/types.ts';

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

  type ExtensionSeverity = 'none' | 'warn' | 'crit';
  type ExtensionReport = { severity: Exclude<ExtensionSeverity, 'none'>; count: number };

  const REPORT_EVENT = 'mpu:fleet-health-report';
  const ctxApi = useWidget();
  const api = mpuApi ?? ctxApi;
  const i18n = useI18n();

  const injected = mpuParams ?? params;
  const printerId = injected?.printerId ?? api.printer.id;

  if (!injected?.printerId) {
    console.warn('[fleet-health] printerId NOT injected — fallback to active printer.');
  }

  const health = useHealth(api, printerId);

  // Extension sections stay mounted while fleet is open so their summary can colour the
  // compact indicator before the user opens the popover.
  let extensionVersion = $state(0);
  let extensionReports = $state<Record<string, ExtensionReport>>({});
  const invalidReportWarnings = new Set<string>();
  $effect(() => api.extensions.onChange(() => extensionVersion += 1));

  let healthExtensions = $derived.by(() => {
    void extensionVersion;
    return api.extensions.list('fleet-health-sections', { printerId });
  });

  /** Removes one contribution's summary without disturbing other providers. */
  function clearExtensionReport(ref: string): void {
    if (!(ref in extensionReports)) return;
    const next = { ...extensionReports };
    delete next[ref];
    extensionReports = next;
  }

  /** Accepts only the documented point contract so a broken extension cannot poison health. */
  function readExtensionReport(detail: unknown): ExtensionReport | null | undefined {
    if (!detail || typeof detail !== 'object') return undefined;
    const { severity, count } = detail as { severity?: unknown; count?: unknown };
    if (severity === 'none' && count === 0) return null;
    if ((severity === 'warn' || severity === 'crit') && Number.isInteger(count) && (count as number) > 0) {
      return { severity, count: count as number };
    }
    return undefined;
  }

  /** Mounts a provider with its own PluginApi and owns its latest summary by contribution ref. */
  function mountHealthExtension(node: HTMLElement, ref: ExtensionRef) {
    const onReport = (event: Event): void => {
      const report = readExtensionReport((event as CustomEvent<unknown>).detail);
      if (report === undefined) {
        clearExtensionReport(ref.ref);
        if (!invalidReportWarnings.has(ref.ref)) {
          invalidReportWarnings.add(ref.ref);
          console.warn(`[fleet-health] ${ref.ref} sent an invalid ${REPORT_EVENT} payload.`);
        }
        return;
      }
      if (report === null) clearExtensionReport(ref.ref);
      else extensionReports = { ...extensionReports, [ref.ref]: report };
    };
    node.addEventListener(REPORT_EVENT, onReport);
    const mounted = api.extensions.mount(node, ref.ref, { printerId });
    return {
      destroy(): void {
        node.removeEventListener(REPORT_EVENT, onReport);
        mounted.destroy();
        clearExtensionReport(ref.ref);
        invalidReportWarnings.delete(ref.ref);
      },
    };
  }

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

  // Core health stays honest when Klipper is unavailable: no issues is not automatically OK.
  let coreWorst = $derived.by<Severity>(() => {
    if (issues.length > 0) return issues.some((issue) => issue.severity === 'crit') ? 'crit' : 'warn';
    return health.klippyReady ? 'ok' : 'unknown';
  });

  let extensionCount = $derived(Object.values(extensionReports).reduce((sum, report) => sum + report.count, 0));
  let extensionCritical = $derived(
    Object.values(extensionReports).reduce((sum, report) => sum + (report.severity === 'crit' ? report.count : 0), 0),
  );
  let worst = $derived.by<Severity>(() => {
    const reports = Object.values(extensionReports);
    if (coreWorst === 'crit' || reports.some((report) => report.severity === 'crit')) return 'crit';
    if (coreWorst === 'warn' || reports.some((report) => report.severity === 'warn')) return 'warn';
    return coreWorst;
  });

  let allOk = $derived(issues.length === 0 && health.klippyReady);

  // Groups have a stable host → MCU → driver order in every locale and direction.
  const SCOPES = ['host', 'mcu', 'tmc'] as const;
  const scopeLabel: Record<(typeof SCOPES)[number], string> = {
    host: 'system.health.host',
    mcu: 'system.health.mcu',
    tmc: 'system.health.drivers',
  };
  let grouped = $derived(
    SCOPES.map((scope) => ({
      scope,
      issues: issues.filter((issue) => issue.scope === scope),
    })).filter((group) => group.issues.length > 0),
  );

  /** Dynamic bus-state keys may have no translation, so MCU values fall back to raw text. */
  function issueText(issue: HealthIssue): string {
    const translated = i18n.t(issue.textKey, issue.params ?? {});
    return translated === issue.textKey && issue.scope === 'mcu' && issue.textKey.startsWith('system.link.bus.')
      ? issue.textKey.slice('system.link.bus.'.length)
      : translated;
  }

  let indicatorTitle = $derived.by(() => {
    const count = issues.length + extensionCount;
    if (count === 0) return allOk ? i18n.t('fleet.health.ok') : i18n.t('system.health.state.unknown');
    return i18n.t('fleet.health.issuesTooltip', {
      state: i18n.t(`system.health.state.${worst}`),
      count,
      crit: countCritical(issues) + extensionCritical,
    });
  });

  const POPOVER_WIDTH = 280;
  let btnEl = $state<HTMLButtonElement | null>(null);
  let popoverOpen = $state(false);
  let popoverStyle = $state('');

  /** Positions and opens the fixed popover without being clipped by the fleet card. */
  function openPopover(): void {
    const rect = btnEl?.getBoundingClientRect();
    if (rect) {
      // The shared helper aligns to the logical start and flips to the end when space is tight.
      popoverStyle = placeChipPopover(rect, { width: POPOVER_WIDTH, height: 240 });
    }
    popoverOpen = true;
  }

  /** Closes the popover without unmounting extension providers. */
  function closePopover(): void {
    popoverOpen = false;
  }

  /** Opens Machine → Monitoring for this card's printer; routing closes fleet mode. */
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
  {/if}

  <!-- Hidden popover content remains connected so extension reports stay current. -->
  <div class="fh-popover" style={popoverStyle} role="dialog" aria-label={i18n.t('fleet.health.title')} hidden={!popoverOpen}>
    <h3 class="fh-title">{i18n.t('fleet.health.title')}</h3>

    <div class="fh-list">
      {#if allOk && extensionCount === 0}
        <p class="fh-ok">{i18n.t('fleet.health.ok')}</p>
      {:else if issues.length === 0 && !health.klippyReady}
        <p class="fh-unknown">{i18n.t('system.health.state.unknown')}</p>
      {:else if issues.length > 0}
        {#each grouped as group (group.scope)}
          <div class="fh-group">
            <span class="fh-group-name">{i18n.t(scopeLabel[group.scope])}</span>
            <ul>
              {#each group.issues as issue (`${issue.scope}:${issue.target}:${issue.textKey}`)}
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
      {/if}

      {#each healthExtensions as extension (extension.ref)}
        <div class="fh-extension" use:mountHealthExtension={extension}></div>
      {/each}
    </div>

    <button type="button" class="fh-open" onclick={openMonitoring}>
      {i18n.t('fleet.health.openMonitoring')}
    </button>
  </div>
</div>

<style>
  .fh-root {
    position: relative;
    height: 100%;
    display: flex;
  }

  /* The button fills its grid cell, matching other compact fleet actions. */
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

  .fh-popover[hidden] {
    display: none;
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

  /* One scroll container keeps core and extension sections inside narrow viewports. */
  .fh-list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-height: 0;
  }

  .fh-extension {
    min-width: 0;
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

  /* Long localized text wraps instead of clipping narrow fleet cards and mobile screens. */
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
