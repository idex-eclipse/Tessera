import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import type { TemperatureSensor } from '../types';
import TempPanel from '../components/fleet/TempPanel.svelte';

const state = vi.hoisted(() => ({ sensors: [] as TemperatureSensor[] }));

vi.mock('../../../../plugin-sdk/src/svelte/index', () => ({
  useWidget: () => null,
  useI18n: () => ({ t: (key: string, params?: Record<string, string>) =>
    key === 'fleet.temps.editTarget' ? `Set target for ${params?.name}` : key }),
}));
vi.mock('../data/use-temperature.svelte.ts', () => ({
  useTemperatureData: () => ({ sensors: state.sensors, connected: true, klippyState: 'ready' }),
}));

/** Provide the three sensor kinds with limits that permit a zero off target. */
function sensor(name: string, kind: TemperatureSensor['kind'], minTemp: number | null, maxTemp: number | null): TemperatureSensor {
  return {
    name, displayName: name, kind, color: 'red', temperature: 22, target: 0,
    power: null, rate: null, speed: null, minTemp, maxTemp,
    chartVisible: false, powerVisible: false,
  };
}

/** Mount a card whose active printer differs from the target printer. */
function setup(request: (method: string, params: unknown) => Promise<unknown>) {
  state.sensors = [
    sensor('extruder', 'heater', 5, 300),
    sensor('temperature_fan chamber', 'fan', 10, 80),
    sensor('temperature_sensor board', 'sensor', null, null),
  ];
  const activeRequest = vi.fn(async () => ({}));
  const targetRequest = vi.fn(request);
  const api = {
    printer: { id: 'active' },
    moonrakerFor: vi.fn((id: string) => ({ request: id === 'target' ? targetRequest : activeRequest })),
  } as unknown as PluginApi;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(TempPanel, { target, props: { mpuApi: api, mpuParams: { printerId: 'target' } } });
  flushSync();
  return { target, targetRequest, activeRequest, stop: () => { unmount(component); target.remove(); } };
}

/** Commit through the same inline target field and Enter behavior as the widget. */
function commit(view: ReturnType<typeof setup>, name: string, value: string): void {
  const input = view.target.querySelector(`input[aria-label="Set target for ${name}"]`) as HTMLInputElement;
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
}

describe('fleet temperature targets', () => {
  it('sets heater and temperature fan targets only on the card printer', async () => {
    const view = setup(async () => ({}));
    try {
      expect(view.target.querySelectorAll('.target-field')).toHaveLength(2);
      expect(view.target.querySelector('form')).toBeNull();
      commit(view, 'extruder', '0');
      await vi.waitFor(() => expect(view.targetRequest).toHaveBeenCalledWith('printer.gcode.script', {
        script: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0',
      }));
      await vi.waitFor(() => expect((view.target.querySelector('input[aria-label="Set target for extruder"]') as HTMLInputElement).disabled).toBe(false));
      commit(view, 'temperature_fan chamber', '40');
      await vi.waitFor(() => expect(view.targetRequest).toHaveBeenCalledWith('printer.gcode.script', {
        script: 'SET_TEMPERATURE_FAN_TARGET FAN=chamber TARGET=40',
      }));
      expect(view.activeRequest).not.toHaveBeenCalled();
    } finally { view.stop(); }
  });

  it('commits on blur and disables both fields while the target request is pending', async () => {
    let finish!: (value: unknown) => void;
    const view = setup(() => new Promise((resolve) => { finish = resolve; }));
    try {
      const input = view.target.querySelector('input[aria-label="Set target for extruder"]') as HTMLInputElement;
      input.focus();
      input.value = '190';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      flushSync();
      expect(view.targetRequest).toHaveBeenCalledTimes(1);
      expect([...view.target.querySelectorAll('.target-field input')].every((field) => (field as HTMLInputElement).disabled)).toBe(true);
      finish({});
      await vi.waitFor(() => expect(input.disabled).toBe(false));
    } finally { view.stop(); }
  });

  it('rejects values outside sensor limits without sending a request', () => {
    const view = setup(async () => ({}));
    try {
      commit(view, 'extruder', '301');
      expect(view.targetRequest).not.toHaveBeenCalled();
      expect(view.target.querySelector('[role="alert"]')).not.toBeNull();
      commit(view, 'extruder', '3');
      expect(view.targetRequest).not.toHaveBeenCalled();
    } finally { view.stop(); }
  });

  it('shows a request error beside the inline field', async () => {
    const view = setup(async () => { throw new Error('offline'); });
    try {
      commit(view, 'extruder', '200');
      await vi.waitFor(() => expect(view.target.querySelector('[role="alert"]')?.textContent).toBe('fleet.temps.setFailed'));
      expect(view.target.querySelector('input[aria-label="Set target for extruder"]')).not.toBeNull();
    } finally { view.stop(); }
  });

  it('lets the host own guard rejection feedback', async () => {
    const view = setup(async () => { throw { rejection: { code: 'denied_by_guard' } }; });
    try {
      commit(view, 'extruder', '200');
      await vi.waitFor(() => expect(view.targetRequest).toHaveBeenCalledTimes(1));
      expect(view.target.querySelector('[role="alert"]')).toBeNull();
    } finally { view.stop(); }
  });
});
