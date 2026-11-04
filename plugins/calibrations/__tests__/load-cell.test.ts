import { describe, expect, it, vi } from 'vitest';
import { binSamples, parseForceBatch, parseTap } from '../load-cell/force-parse';
import { ForceBuffer } from '../load-cell/force-buffer';
import { findLoadCellProbes, loadCellProbeName } from '../load-cell/load-cell-config';
import { startForceSource, startTapSource } from '../load-cell/force-source';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';

describe('load cell probe detection', () => {
  it('takes only [load_cell_probe] sections, never a plain [load_cell]', () => {
    const found = findLoadCellProbes(['probe', 'load_cell', 'load_cell foo', 'load_cell_probe', 'load_cell_probe bar']);
    expect(found.map((p) => p.section)).toEqual(['load_cell_probe', 'load_cell_probe bar']);
  });

  it('uses the last word of the section as the stream name', () => {
    expect(loadCellProbeName('load_cell_probe')).toBe('load_cell_probe');
    expect(loadCellProbeName('load_cell_probe bar')).toBe('bar');
  });
});

describe('force stream parsing', () => {
  it('reads grams when every row is calibrated', () => {
    const b = parseForceBatch({ data: [[1, 10, 100, 90], [2, 12, 120, 90]] });
    expect(b.unit).toBe('g');
    expect(b.samples).toEqual([{ time: 1, value: 10 }, { time: 2, value: 12 }]);
  });

  it('falls back to counts minus tare when uncalibrated', () => {
    const b = parseForceBatch({ data: [[1, null, 100, 90]] });
    expect(b.unit).toBe('counts');
    expect(b.samples).toEqual([{ time: 1, value: 10 }]);
  });

  it('skips malformed rows and bins samples', () => {
    expect(parseForceBatch({ data: ['x', [NaN, 1, 1, 1]] }).samples).toEqual([]);
    expect(parseForceBatch(null).samples).toEqual([]);
    const binned = binSamples([{ time: 0, value: 2 }, { time: 0.01, value: 4 }, { time: 0.05, value: 10 }], 0.02);
    expect(binned).toEqual([{ time: 0.01, value: 3 }, { time: 0.05, value: 10 }]);
  });

  it('parses a tap and rebases time to its first sample', () => {
    expect(parseTap({ tap: { time: [100, 100.5, 101], force: [1, 2, 3] } })).toEqual({
      times: [0, 0.5, 1],
      force: [1, 2, 3],
    });
    expect(parseTap({ tap: { time: [], force: [] } })).toBeNull();
    expect(parseTap({})).toBeNull();
  });
});

describe('force buffer', () => {
  it('drops points older than the window and caps the length', () => {
    const b = new ForceBuffer(10, 5);
    for (let t = 0; t < 30; t++) b.push(t, t);
    expect(b.length).toBeLessThanOrEqual(5);
    expect(b.last()).toEqual({ time: 29, value: 29 });
    expect(b.range()).toEqual({ min: 25, max: 29 });
    b.clear();
    expect(b.last()).toBeNull();
  });
});

describe('force sources', () => {
  const probe = { section: 'load_cell_probe', name: 'load_cell_probe' };

  it('streams with the documented method and releases the stream on stop', () => {
    const cancel = vi.fn();
    const klippyStream = vi.fn((_method: string, _params: unknown) => cancel);
    const handle = { klippyStream, subscribe: vi.fn() } as never;
    const stop = startForceSource(handle, probe, { onSamples: vi.fn(), onSource: vi.fn() });
    expect(klippyStream.mock.calls[0]![0]).toBe('load_cell/dump_force');
    // the documented parameter name (Klipper API_Server.md) is `sensor`
    expect(klippyStream.mock.calls[0]![1]).toEqual({ sensor: 'load_cell_probe' });
    stop();
    expect(cancel).toHaveBeenCalled();
  });

  it('falls back to the status subscription when the host has no klippyStream', () => {
    const off = vi.fn();
    const subscribe = vi.fn(() => off);
    const stop = startForceSource({ subscribe } as never, probe, { onSamples: vi.fn(), onSource: vi.fn() });
    expect(subscribe).toHaveBeenCalled();
    stop();
    expect(off).toHaveBeenCalled();
  });

  it('delivers taps from the tap stream', () => {
    let push: (d: unknown) => void = () => {};
    const klippyStream = vi.fn((_m: string, _p: unknown, onData: (d: unknown) => void) => {
      push = onData;
      return () => {};
    });
    const onTap = vi.fn();
    startTapSource({ klippyStream } as never, probe, onTap);
    expect(klippyStream.mock.calls[0]![0]).toBe('load_cell_probe/dump_taps');
    expect(klippyStream.mock.calls[0]![1]).toEqual({ sensor: 'load_cell_probe' });
    push({ tap: { time: [5, 6], force: [1, 2] } });
    expect(onTap).toHaveBeenCalledWith({ times: [0, 1], force: [1, 2] });
  });
});

describe('force chart i18n', () => {
  it('has the same keys in en and ru', () => {
    const enKeys = Object.keys((en as any).calibrations.probe.force).sort();
    const ruKeys = Object.keys((ru as any).calibrations.probe.force).sort();
    expect(ruKeys).toEqual(enKeys);
  });
});
