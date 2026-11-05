import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import { binSamples, parseForceBatch, parseTap, type ForceSample, type ForceUnit, type TapTrace } from '../lib/load-cell/force-parse';
import type { LoadCellProbeInfo } from '../lib/load-cell/load-cell-config';
import { MainsFilter, type MainsHz } from '../lib/load-cell/mains-filter';
import { openStream } from '../lib/load-cell/stream-keys';

/**
 * Where the live force trace comes from.
 *
 * 1. `stream` — `handle.klippyStream('load_cell/dump_force', …)`: the host opens Moonraker's
 *    raw Klippy bridge and delivers every sample the sensor produces.
 * 2. `status` — fallback when the bridge is unreachable (nginx without `/klippysocket`,
 *    mixed content): the regular status subscription of the probe object, about 4 Hz.
 *
 * The stream makes Klipper push every sample until cancelled, so the caller starts a source
 * only while the graph is on screen and stops it when it is not.
 */

export type SourceKind = 'stream' | 'status';
export type SourceState = 'connecting' | 'live' | 'unavailable';

export interface ForceSink {
  /** New samples (already binned for the chart) and their unit. */
  onSamples(samples: ForceSample[], unit: ForceUnit): void;
  onSource(kind: SourceKind, state: SourceState): void;
  /** Whether the mains filter could act on the data (false: sensor too slow, or status fallback). */
  onMains?(active: boolean): void;
}

/** Chart resolution: samples closer than this are averaged. */
export const BIN_SECONDS = 0.02;

/** Allowed stream methods of the host (see docs/en/moonraker-proxy.md). */
export const FORCE_METHOD = 'load_cell/dump_force';
export const TAP_METHOD = 'load_cell_probe/dump_taps';

/**
 * Starts the live force source; returns a stop function.
 *
 * `mains` is read for every batch (the user can toggle it while the stream runs) and returns
 * the mains frequency to filter out, or 0 for none. The filter runs on the sensor's own
 * samples, before they are binned for the chart.
 */
export function startForceSource(
  handle: MoonrakerProxyHandle,
  probe: LoadCellProbeInfo,
  sink: ForceSink,
  clock: () => number = () => performance.now() / 1000,
  mains: () => MainsHz | 0 = () => 0,
): () => void {
  let comb: MainsFilter | null = null;
  let stopRate: (() => void) | null = null;
  /** `sample_rate` from the status of the sensor, Hz; 0 until known. */
  let sampleRate = 0;
  let stopStream: (() => void) | null = null;
  let stopStatus: (() => void) | null = null;
  let stopped = false;

  const startStatus = (): void => {
    if (stopStatus || stopped) return;
    sink.onSource('status', 'connecting');
    // `force_g` is in the status of [load_cell_probe]: it includes all items of [load_cell]
    // (Status_Reference.md). A missing field just means "no data".
    stopStatus = handle.subscribe(
      { [probe.section]: ['force_g'] },
      (delta: Record<string, { force_g?: unknown } | undefined>) => {
        const g = delta?.[probe.section]?.force_g;
        if (typeof g !== 'number' || !Number.isFinite(g)) return;
        sink.onSource('status', 'live');
        // about 4 Hz cannot represent mains hum: report that the filter has nothing to act on
        sink.onMains?.(false);
        sink.onSamples([{ time: clock(), value: g }], 'g');
      },
      { immediate: true },
    );
  };

  const endStatus = (): void => {
    stopStatus?.();
    stopStatus = null;
  };

  // The sensor reports its sample rate in its status. It is read only while the mains filter
  // is on, and tells the filter whether the sensor can represent the hum at all.
  const watchRate = (on: boolean): void => {
    if (on && !stopRate && !stopped) {
      stopRate = handle.subscribe(
        { [probe.section]: ['sample_rate'] },
        (delta: Record<string, { sample_rate?: unknown } | undefined>) => {
          const r = delta?.[probe.section]?.sample_rate;
          if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return;
          sampleRate = r;
          comb?.setSampleRate(r);
        },
        { immediate: true },
      );
    } else if (!on && stopRate) {
      stopRate();
      stopRate = null;
      sampleRate = 0;
    }
  };

  if (typeof handle.klippyStream !== 'function') {
    startStatus();
  } else {
    stopStream = openStream(
      handle,
      FORCE_METHOD,
      // documented key first; older Klipper answers "Missing Argument [load_cell]" to it
      [{ sensor: probe.name }, { load_cell: probe.name }],
      (params) => {
        const batch = parseForceBatch(params);
        if (!batch.samples.length) return;
        let samples = batch.samples;
        const hz = mains();
        watchRate(hz !== 0);
        if (hz) {
          if (!comb || comb.period !== 1 / hz) {
            comb = new MainsFilter(hz);
            comb.setSampleRate(sampleRate);
          }
          samples = comb.process(samples);
          sink.onMains?.(comb.active);
        } else {
          comb = null;
        }
        sink.onSamples(binSamples(samples, BIN_SECONDS), batch.unit);
      },
      (state) => {
        if (stopped) return;
        if (state === 'unavailable') {
          sink.onSource('stream', 'unavailable');
          startStatus();
        } else {
          endStatus();
          sink.onSource('stream', state);
        }
      },
    );
  }

  return () => {
    stopped = true;
    stopStream?.();
    stopStream = null;
    stopRate?.();
    stopRate = null;
    endStatus();
  };
}

/**
 * Starts the probing tap stream: calls `onTap` with the force trace of every tap.
 * Returns a stop function; a host without `klippyStream` simply yields no taps.
 */
export function startTapSource(
  handle: MoonrakerProxyHandle,
  probe: LoadCellProbeInfo,
  onTap: (tap: TapTrace) => void,
  onStatus?: (state: SourceState) => void,
): () => void {
  if (typeof handle.klippyStream !== 'function') {
    onStatus?.('unavailable');
    return () => {};
  }
  return openStream(
    handle,
    TAP_METHOD,
    // documented key first; older Klipper answers "Missing Argument [load_cell_probe]" to it
    [{ sensor: probe.name }, { load_cell_probe: probe.name }],
    (params) => {
      const tap = parseTap(params);
      if (tap) onTap(tap);
    },
    onStatus,
  );
}
