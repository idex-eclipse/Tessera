<script lang="ts">
  import { onMount } from 'svelte';

  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { startNotificationProducers } from '../../notification-producers.ts';
  import { ensurePrintTracker } from '../../data/print-tracker.ts';

  const api = usePluginApi();

  // Оверлей без интерфейса: смонтирован всегда (постоянная поверхность) и держит живыми
  // источники уведомлений всех принтеров. Центр уведомлений и тосты — в хосте.
  onMount(() => startNotificationProducers(api));

  // Заодно запускает трекер состояния печати всех принтеров для гарда system-print-safety (идемпотентно).
  ensurePrintTracker(api);
</script>
