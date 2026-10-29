<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { useSystem, type ProcPoint } from '../../use-system.svelte.ts';
  import ChartGrid from './ChartGrid.svelte';
  import type { ChartDef } from './chart-types';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);

  const C = {
    cpu: '#61afef',
    load: '#e5c07b',
    ram: '#40c4ff',
    klipper: '#e06c75',
    moonraker: '#ff6d00',
    temp: '#ffab40',
  };

  let charts = $derived.by((): ChartDef<ProcPoint>[] => {
    const cores = store.systemInfo.cpuCount || 0;

    return [
      {
        id: 'cpu',
        title: i18n.t('system.charts.cpuLoad'),
        fixed: true,
        series: [{ label: 'CPU', color: C.cpu, unit: '%', get: (p) => p.sysCpu }],
      },
      {
        id: 'osload',
        title: i18n.t('system.charts.osLoad'),
        fixed: false,
        fmt: (v) => (cores > 0 ? `${v.toFixed(2)} / ${cores}` : v.toFixed(2)),
        series: [{ label: 'load1', color: C.load, unit: '', get: (p) => p.load1 }],
      },
      {
        id: 'ram',
        title: i18n.t('system.charts.ram'),
        fixed: true,
        series: [
          {
            label: 'RAM',
            color: C.ram,
            unit: '%',
            get: (p) => (p.memUsed != null && p.memTotal ? (p.memUsed / p.memTotal) * 100 : null),
          },
        ],
      },
      {
        id: 'klipper',
        title: i18n.t('system.charts.klipper'),
        fixed: true,
        series: [{ label: 'Klipper', color: C.klipper, unit: '%', get: (p) => p.klipperCpu }],
      },
      {
        id: 'moonraker',
        title: i18n.t('system.charts.moonraker'),
        fixed: true,
        series: [{ label: 'Moonraker', color: C.moonraker, unit: '%', get: (p) => p.mkCpu }],
      },
      {
        id: 'temp',
        title: i18n.t('system.charts.temp'),
        fixed: false,
        series: [{ label: 'CPU', color: C.temp, unit: '°C', get: (p) => p.cpuTemp }],
      },
    ];
  });
</script>

<ChartGrid {charts} points={store.proc} />
