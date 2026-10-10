<script lang="ts">
  import type { ConnectionStatus as ConnectionStatusType } from '@sdk/types';

  let { status }: { status: ConnectionStatusType } = $props();

  let dotClass = $derived.by(() => {
    switch (status) {
      case 'open':
        return 'status-open';
      case 'connecting':
        return 'status-connecting';
      case 'closed':
        return 'status-closed';
      default:
        return 'status-closed';
    }
  });
</script>

<span class="status-dot {dotClass}" title={status}></span>

<style>
  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-open {
    background: var(--success);
  }

  .status-connecting {
    background: var(--warning);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-closed {
    background: var(--danger);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>