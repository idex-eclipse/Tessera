<script lang="ts">
  import {
    UPlotChart,
    buildChartData,
    type SeriesDef,
    type ChartData,
  } from '../../../shared/uplot-core';

  import { buildSeriesDefs } from '../chart-data';
  import type {
    SensorBuffers,
    TemperatureSensor,
  } from '../use-temperature.svelte';

  let {
    sensors,
    buffers,
    tick,
  }: {
    sensors: TemperatureSensor[];
    buffers: Map<string, SensorBuffers>;
    tick: number;
  } = $props();

  let defs = $derived<SeriesDef[]>(buildSeriesDefs(sensors));

  let data = $derived.by<ChartData>(() => {
    void tick;
    return buildChartData(buffers, defs)
  })
</script>

<div class="temp-chart-wrap">
  <UPlotChart {defs} {data} {tick} height="100%" />
</div>

<style>
  .temp-chart-wrap {
    width: 100%;
    min-height: 400px;
    height: 100%;
  }
</style>