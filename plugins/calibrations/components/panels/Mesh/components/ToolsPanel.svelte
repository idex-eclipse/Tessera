<script lang="ts">
  import { usePluginApi } from '../../../../../../plugin-sdk/src/svelte/index';

  import { gcode, runGcode } from '../../../../commands';
  import type { BedMeshTools, BedMeshStore } from '../../../../use-bed-mesh.svelte.ts';

  import { bedMeshUiState } from '../../../../bed-mesh-ui-state.svelte.ts';

  let { store }: { store: BedMeshStore } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;

  let busy = $state('');

  // Убраны probeCalibrate и manualProbe — они на вкладке "Probe & Z-offset"
  const TOOLS: Array<{ key: keyof BedMeshTools; labelKey: string; script: string }> = [
    { key: 'zTilt', labelKey: 'bedMesh.tools.zTilt', script: gcode.zTiltAdjust },
    { key: 'qgl', labelKey: 'bedMesh.tools.qgl', script: gcode.quadGantryLevel },
    { key: 'screws', labelKey: 'bedMesh.tools.screws', script: gcode.screwsTiltCalculate },
  ];

  let visible = $derived(TOOLS.filter((t) => store.tools[t.key]));

  async function run(toolKey: string, script: string): Promise<void> {
    busy = toolKey;
    try {
      await runGcode(api.moonraker(), script);
      await store.refresh();
      if (toolKey === 'screws') bedMeshUiState.screwsOverlayOpen = true;
    } catch (e) {
      console.error('[bed-mesh] gcode failed:', script, e);
    } finally {
      busy = '';
    }
  }
</script>

{#if visible.length === 0}
  <p class="empty">{i18n.t('bedMesh.tools.empty')}</p>
{:else}
  <div class="tools-list">
    {#each visible as tool (tool.key)}
      <button
        class="tool-btn"
        disabled={busy !== ''}
        onclick={() => run(tool.key, tool.script)}
      >
        <span class="tool-label">{i18n.t(tool.labelKey)}</span>
        {#if busy === tool.key}
          <span class="spinner" aria-hidden="true"></span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-md);
    font-size: var(--font-size-sm);
  }

  .tools-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .tool-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover-no-override);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    text-align: start;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
    border-color: var(--accent);
  }

  .tool-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .tool-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>