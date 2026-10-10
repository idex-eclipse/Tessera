/**
 * Детект активных калибровок через server.gcode_store: мгновенная реакция
 * на notify_gcode_response + поллинг-страховка (паттерн console-session).
 * Klipper не эхо-отражает команды в notify_gcode_response, поэтому старты
 * видим только в store (команды всех клиентов). Сканирование — ПРЯМЫМ
 * хронологическим проходом: обратный обход перезаписывал активный прогон
 * финишем предыдущего.
 */
import type { PluginApi } from '../../plugin-sdk/src/types';
import { heaters, resetHeatersState } from './heaters-state.svelte.ts';
import { shaper, resetShaperState } from './shaper-state.svelte.ts';
import { RE_PID, RE_FITTED, RE_RECOMMENDED } from './parse.ts';

const STORE_COUNT = 200;
const POLL_MS = 5000;

interface GcodeStoreEntry {
  message: string;
  time?: number;
  type?: string;
}

// стартовые токены команд (для content-fallback классификации)
const START_CMD_RE =
  /^(PID_CALIBRATE|TEST_RESONANCES|SHAPER_CALIBRATE|PROBE_CALIBRATE|Z_ENDSTOP_CALIBRATE|PROBE_EDDY_CURRENT_CALIBRATE|RUN_SHELL_COMMAND|SET_INPUT_SHAPER)\b/i;
const RE_PID_CMD = /^PID_CALIBRATE\b/i;
const RE_HEATER_PARAM = /HEATER=(\S+)/i;
const RE_TARGET_PARAM = /TARGET=(\d+(?:\.\d+)?)/i;
const RE_TEST_CMD = /^TEST_RESONANCES\b/i;
const RE_SHAPER_CMD = /^SHAPER_CALIBRATE\b/i;
const RE_AXIS_PARAM = /AXIS=([^\s]+)/i;
const RE_OUTPUT_RAW = /OUTPUT\s*=\s*raw_data/i;
const RE_ABORT = /^!!/;

function mapEntries(raw: unknown): GcodeStoreEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: any) => ({
    message: String(e?.message ?? ''),
    time: typeof e?.time === 'number' ? e.time : undefined,
    type: typeof e?.type === 'string' ? e.type : undefined,
  }));
}

/** type из Moonraker первичен; при его отсутствии — классификация по контенту. */
function isCommand(e: GcodeStoreEntry, msg: string): boolean {
  if (e.type === 'command') return true;
  if (e.type === 'response') return false;
  return START_CMD_RE.test(msg);
}

interface PidScan {
  state: 'idle' | 'tuning' | 'finished';
  heater: string;
  target: number;
  result: { kp: number; ki: number; kd: number } | null;
}

interface ShaperScan {
  state: 'idle' | 'busy' | 'finished';
  axis: string;
  isBelt: boolean;
  fitted: Array<{ name: string; freq: number; vib: number; smooth: number }>;
  recommended: { name: string; freq: number } | null;
}

/** Прямой проход: каждая стартовая команда открывает процесс заново,
 *  финиш/!! закрывают только незакрытый. Порядок событий корректен по построению. */
function scanEntries(entries: GcodeStoreEntry[]): void {
  const pid: PidScan = { state: 'idle', heater: '', target: 0, result: null };
  const shp: ShaperScan = { state: 'idle', axis: '', isBelt: false, fitted: [], recommended: null };

  for (const e of entries) {
    const msg = e.message.trim();
    if (!msg) continue;

    if (isCommand(e, msg)) {
      if (RE_PID_CMD.test(msg)) {
        pid.state = 'tuning';
        pid.heater = RE_HEATER_PARAM.exec(msg)?.[1] ?? '';
        pid.target = parseFloat(RE_TARGET_PARAM.exec(msg)?.[1] ?? '0') || 0;
        pid.result = null;
        continue;
      }
      if (RE_TEST_CMD.test(msg) || RE_SHAPER_CMD.test(msg)) {
        const ax = (RE_AXIS_PARAM.exec(msg)?.[1] ?? '').trim();
        shp.state = 'busy';
        shp.axis = ax;
        shp.isBelt = ax.includes(',') || RE_OUTPUT_RAW.test(msg);
        shp.fitted = [];
        shp.recommended = null;
        continue;
      }
      continue;
    }

    // ответы
    const fm = RE_PID.exec(msg);
    if (fm) {
      pid.state = 'finished';
      pid.result = { kp: +fm[1]!, ki: +fm[2]!, kd: +fm[3]! };
      continue;
    }
    if (RE_ABORT.test(msg)) {
      if (pid.state === 'tuning') {
        pid.state = 'finished';
        pid.result = null;
      }
      if (shp.state === 'busy') shp.state = 'finished';
      continue;
    }
    const fit = RE_FITTED.exec(msg);
    if (fit && shp.state === 'busy') {
      shp.fitted.push({ name: fit[1]!, freq: +fit[2]!, vib: +fit[3]!, smooth: +fit[4]! });
      continue;
    }
    const rec = RE_RECOMMENDED.exec(msg);
    if (rec && shp.state === 'busy') {
      shp.recommended = { name: rec[1]!, freq: +rec[2]! };
      shp.state = 'finished';
      continue;
    }
  }

  // --- применение к module-state ---
  if (pid.state === 'tuning') {
    if (pid.heater) heaters.heater = pid.heater;
    if (pid.target > 0) heaters.target = pid.target;
    heaters.tuning = true;
    heaters.result = null;
  } else if (pid.state === 'finished') {
    heaters.tuning = false;
    if (pid.result) heaters.result = pid.result;
  }
  // pid.state === 'idle' → store не содержит событий: state не трогаем

  const uiRun = shaper.busy !== '' && !shaper.external;
  if (shp.state === 'busy') {
    if (!uiRun) {
      shaper.external = true;
      shaper.busy = shp.isBelt ? 'belts' : 'test';
      if (!uiRun) {
        shaper.fitted = shp.fitted;
        shaper.recommended = shp.recommended;
      }
    }
    const ax = shp.axis.toUpperCase();
    if (ax === 'X' || ax === 'Y') shaper.axis = ax;
  } else if (shp.state === 'finished') {
    if (shaper.external) {
      shaper.busy = '';
      shaper.external = false;
    }
    if (!uiRun) {
      if (shp.fitted.length) shaper.fitted = shp.fitted;
      if (shp.recommended) shaper.recommended = shp.recommended;
    }
  }
}

export function subscribeCalibrationsGcodeStore(api: PluginApi): () => void {
  let unsubs: Array<() => void> = [];
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let gen = 0;
  let printerId = '';
  let stopped = false;

  function teardownSubs(): void {
    for (const u of unsubs.splice(0)) u();
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function refresh(g: number): Promise<void> {
    let h;
    try {
      h = api.moonraker();
    } catch {
      return;
    }
    if (h.readyState !== 'open') return;

    let entries: GcodeStoreEntry[] = [];
    try {
      const res = await h.request<any>('server.gcode_store', { count: STORE_COUNT });
      entries = mapEntries(Array.isArray(res) ? res : (res?.gcode_store ?? []));
    } catch {
      return; // offline / klippy not ready — следующий тик
    }
    if (stopped || g !== gen || printerId !== api.printer.id) return;

    scanEntries(entries);
  }

  function setup(): void {
    teardownSubs();
    gen++;
    const g = gen;
    printerId = api.printer.id;

    let h;
    try {
      h = api.moonraker();
    } catch {
      return;
    }

    unsubs.push(
      h.onNotify('notify_gcode_response', () => {
        void refresh(g);
      }),
    );
    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        resetHeatersState();
        resetShaperState();
        void refresh(g);
      }),
    );
    unsubs.push(
      h.onNotify('notify_klippy_shutdown', () => {
        heaters.tuning = false;
        if (shaper.external) {
          shaper.busy = '';
          shaper.external = false;
        }
      }),
    );

    pollTimer = setInterval(() => void refresh(g), POLL_MS);

    // смена принтера: переподписка на новый handle (раньше подписка умирала навсегда)
    unsubs.push(
      api.onPrinterChange(() => {
        resetHeatersState();
        resetShaperState();
        setup();
      }),
    );

    void refresh(g);
  }

  setup();

  return () => {
    stopped = true;
    teardownSubs();
  };
}