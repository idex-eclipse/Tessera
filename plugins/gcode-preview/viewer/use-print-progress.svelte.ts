import { onDestroy } from 'svelte';

import type { PluginApi } from '../../../plugin-sdk/src/types';

export function usePrintProgress(api: PluginApi) {
  let filename = $state('');
  let filePosition = $state(0);
  let printing = $state(false);

  const unsubs: Array<() => void> = [];

  function init(): void {
    for (const u of unsubs.splice(0)) u();

    let h;
    try {
      h = api.moonraker();
    } catch {
      return;
    }

    unsubs.push(
      h.subscribe(
        { print_stats: ['filename', 'state'], virtual_sdcard: ['file_position'] },
        (d: any) => {
          const ps = d?.print_stats;
          if (ps) {
            if (typeof ps.filename === 'string') filename = ps.filename;
            if (typeof ps.state === 'string') {
              printing = ps.state === 'printing' || ps.state === 'paused';
            }
          }
          const vs = d?.virtual_sdcard;
          if (vs && typeof vs.file_position === 'number') filePosition = vs.file_position;
        },
        { immediate: true },
      ),
    );
  }

  init();
  const off = api.onPrinterChange(() => init());

  onDestroy(() => {
    for (const u of unsubs) u();
    off();
  });

  return {
    get filename() { return filename; },
    get filePosition() { return filePosition; },
    get printing() { return printing; },
  };
}