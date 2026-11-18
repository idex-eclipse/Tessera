/** Guard the command timing and Moonraker file paths that real printer runs depend on. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import { beltRunLines, gcode, runGcodeLines, shaperRunLines } from '../lib/commands';
import { listPngs, loadPreview, initialShaperState } from '../state/shaper-state.svelte';

afterEach(() => vi.unstubAllGlobals());

const graphCommands = { X: 'generate_x_shaper_graph', Y: 'generate_y_shaper_graph' };
const test = (axis: 'X' | 'Y') => gcode.testResonances(axis);
const calibrate = (axis: 'X' | 'Y') => gcode.shaperCalibrate(axis);

describe('shaper command sequence', () => {
  it('waits between both calibrations and before each graph in X, Y order', async () => {
    const lines = shaperRunLines('pipe', ['X', 'Y'], test, calibrate, graphCommands);
    expect(lines).toEqual([
      'SHAPER_CALIBRATE AXIS=X', 'M400', 'G4 P5000', 'M400',
      'SHAPER_CALIBRATE AXIS=Y', 'M400', 'G4 P5000', 'M400',
      'RUN_SHELL_COMMAND CMD=generate_x_shaper_graph', 'M400', 'G4 P5000', 'M400',
      'RUN_SHELL_COMMAND CMD=generate_y_shaper_graph',
    ]);
    expect(shaperRunLines('calib', ['X', 'Y'], test, calibrate, graphCommands)).toEqual([
      'SHAPER_CALIBRATE AXIS=X', 'M400', 'G4 P5000', 'M400', 'SHAPER_CALIBRATE AXIS=Y',
    ]);

    const request = vi.fn().mockResolvedValue({});
    await runGcodeLines({ request } as unknown as MoonrakerProxyHandle, lines);
    expect(request.mock.calls.map(([method, params]) => [method, params.script])).toEqual(
      lines.map((line) => ['printer.gcode.script', line]),
    );
  });

  it('does not send a graph when a preceding step fails', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('Timer too close'));
    await expect(runGcodeLines({ request } as unknown as MoonrakerProxyHandle, [
      'TEST_RESONANCES AXIS=X', 'RUN_SHELL_COMMAND CMD=generate_x_shaper_graph',
    ])).rejects.toThrow('Timer too close');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('passes documented frequency bounds to calibration', () => {
    expect(gcode.shaperCalibrate('X', { freqStart: 5, freqEnd: 133.3, hzPerSec: 1 })).toBe(
      'SHAPER_CALIBRATE AXIS=X FREQ_START=5 FREQ_END=133.3 HZ_PER_SEC=1',
    );
  });

  it('waits for belt data before the next direction and comparison graph', () => {
    expect(beltRunLines(['1,1', '1,-1'], 'generate_belts_graph')).toEqual([
      'TEST_RESONANCES AXIS=1,1 OUTPUT=raw_data', 'M400', 'G4 P5000', 'M400',
      'TEST_RESONANCES AXIS=1,-1 OUTPUT=raw_data', 'M400', 'G4 P5000', 'M400',
      'RUN_SHELL_COMMAND CMD=generate_belts_graph',
    ]);
  });
});

describe('shaper graphs', () => {
  it('lists PNG files in config and config/shapers via directory requests', async () => {
    const request = vi.fn().mockImplementation(async (_method: string, params: { path: string }) => ({
      files: params.path === 'config'
        ? [{ filename: 'old.png', modified: 1 }, { filename: 'printer.cfg', modified: 2 }]
        : [{ filename: 'x.png', modified: 3 }, { filename: 'y.PNG', modified: 4 }],
    }));
    expect(await listPngs({ request } as unknown as MoonrakerProxyHandle)).toEqual({
      'old.png': 1, 'shapers/x.png': 3, 'shapers/y.PNG': 4,
    });
    expect(request.mock.calls).toEqual([
      ['server.files.get_directory', { path: 'config', extended: false }],
      ['server.files.get_directory', { path: 'config/shapers', extended: false }],
    ]);
  });

  it('loads a graph from the same config path with Moonraker authorization', async () => {
    const fetchImage = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) });
    vi.stubGlobal('fetch', fetchImage);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:graph', revokeObjectURL: vi.fn() });
    const state = initialShaperState();
    await loadPreview(state, {
      httpBaseUrl: 'http://printer:7125', authToken: 'token',
    } as MoonrakerProxyHandle, 'shapers/x graph.png');
    expect(fetchImage).toHaveBeenCalledWith(
      'http://printer:7125/server/files/config/shapers/x%20graph.png',
      { headers: { Authorization: 'Bearer token' }, cache: 'no-store' },
    );
    expect(state.previewUrl).toBe('blob:graph');
  });
});
