/**
 * Чистые функции мониторинга состояния принтера: троттлинг хоста, связь с MCU,
 * шина CAN, драйверы TMC. Без Svelte и DOM — тестируются напрямую.
 *
 * Формы payload'ов Klipper/Moonraker нигде в репозитории не типизированы
 * (MoonrakerStatusDelta = any), поэтому парсеры защитные: любое поле может
 * отсутствовать, а мусор превращается в «нет данных», а не в исключение.
 */

export type Severity = 'ok' | 'warn' | 'crit' | 'unknown';

const SEVERITY_RANK: Record<Severity, number> = { unknown: 0, ok: 1, warn: 2, crit: 3 };

/** Худшая из серьёзностей; `unknown` не перекрывает известное состояние. */
export function worstSeverity(...list: Severity[]): Severity {
  let worst: Severity = 'unknown';
  for (const s of list) if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  return worst;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** `3d 4h`, `5h 12m`, `7m` — две старшие единицы, подписи передаёт вызывающий (i18n). */
export function formatUptime(
  seconds: number,
  units: { d: string; h: string; m: string },
): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}${units.d} ${h}${units.h}`;
  if (h > 0) return `${h}${units.h} ${m}${units.m}`;
  return `${m}${units.m}`;
}

// ------------------------------------------------------------------
// Имена объектов Klipper
// ------------------------------------------------------------------

export const matchMcu = (name: string): boolean => /^mcu(\s|$)/.test(name);
export const matchCanbus = (name: string): boolean => /^canbus_stats(\s|$)/.test(name);
export const matchTmc = (name: string): boolean => /^tmc\d+(\s|$)/.test(name);

/**
 * `mcu` → `mcu`, `mcu EBB` → `EBB`. Совпадает с суффиксом объекта
 * `canbus_stats <имя>`, которым Klipper пользуется для CAN-MCU
 * (основной MCU называется там `mcu`).
 */
export function mcuShortName(objectName: string): string {
  const rest = objectName.replace(/^mcu\s*/, '').trim();
  return rest || 'mcu';
}

export function canbusMcuName(objectName: string): string {
  const rest = objectName.replace(/^canbus_stats\s*/, '').trim();
  return rest || 'mcu';
}

/** `tmc2209 stepper_x` → `{ type: 'tmc2209', stepper: 'stepper_x' }`. */
export function parseTmcName(objectName: string): { type: string; stepper: string } {
  const m = objectName.match(/^(tmc\d+)\s*(.*)$/);
  return { type: m?.[1] ?? objectName, stepper: m?.[2]?.trim() ?? '' };
}

// ------------------------------------------------------------------
// Троттлинг хоста (Moonraker: throttled_state { bits, flags })
// ------------------------------------------------------------------

export type ThrottleFlag = 'undervoltage' | 'freqCapped' | 'throttled' | 'tempLimit';

export const THROTTLE_FLAGS: readonly ThrottleFlag[] = [
  'undervoltage',
  'freqCapped',
  'throttled',
  'tempLimit',
];

/** Биты 0–3 — «сейчас», 16–19 — «было с момента загрузки» (vcgencmd get_throttled). */
const THROTTLE_NOW_BIT: Record<ThrottleFlag, number> = {
  undervoltage: 0,
  freqCapped: 1,
  throttled: 2,
  tempLimit: 3,
};
const THROTTLE_PAST_SHIFT = 16;

/** Строки Moonraker → бит; запасной путь, если `bits` не пришёл. */
const THROTTLE_NAMES: Array<[RegExp, number]> = [
  [/^under-?voltage/i, 0],
  [/^frequency capped/i, 1],
  [/^currently throttled/i, 2],
  [/^temperature limit/i, 3],
  [/^previously under-?volt/i, 16],
  [/^previously frequency/i, 17],
  [/^previously throttled/i, 18],
  [/^previously temperature/i, 19],
];

export interface ThrottleState {
  /** false — хост не умеет отдавать состояние (не Raspberry Pi) */
  supported: boolean;
  bits: number;
  now: ThrottleFlag[];
  past: ThrottleFlag[];
  severity: Severity;
}

export const THROTTLE_UNSUPPORTED: ThrottleState = {
  supported: false,
  bits: 0,
  now: [],
  past: [],
  severity: 'unknown',
};

function throttleBits(raw: Record<string, unknown>): number | null {
  const bits = num(raw.bits);
  if (bits !== undefined) return bits;
  if (!Array.isArray(raw.flags)) return null;
  let acc = 0;
  for (const f of raw.flags) {
    if (typeof f !== 'string') continue;
    const hit = THROTTLE_NAMES.find(([re]) => re.test(f.trim()));
    if (hit) acc |= 1 << hit[1];
  }
  return acc;
}

export function parseThrottled(raw: unknown): ThrottleState {
  if (!raw || typeof raw !== 'object') return THROTTLE_UNSUPPORTED;
  const bits = throttleBits(raw as Record<string, unknown>);
  if (bits === null) return THROTTLE_UNSUPPORTED;

  const now = THROTTLE_FLAGS.filter((f) => (bits >> THROTTLE_NOW_BIT[f]) & 1);
  const past = THROTTLE_FLAGS.filter((f) => (bits >> (THROTTLE_NOW_BIT[f] + THROTTLE_PAST_SHIFT)) & 1);

  let severity: Severity = 'ok';
  if (now.includes('undervoltage') || now.includes('throttled')) severity = 'crit';
  else if (now.length > 0) severity = 'warn';

  return { supported: true, bits, now, past, severity };
}

export const CPU_TEMP_WARN = 80;
export const CPU_TEMP_CRIT = 85;

/** Эвристика для хостов без throttled_state (не-RPi). */
export function cpuTempSeverity(temp: number | null | undefined): Severity {
  if (typeof temp !== 'number' || !Number.isFinite(temp)) return 'unknown';
  if (temp >= CPU_TEMP_CRIT) return 'crit';
  if (temp >= CPU_TEMP_WARN) return 'warn';
  return 'ok';
}

export function hostSeverity(throttle: ThrottleState, cpuTemp: number | null | undefined): Severity {
  return worstSeverity(throttle.severity, cpuTempSeverity(cpuTemp));
}

// ------------------------------------------------------------------
// MCU: last_stats
// ------------------------------------------------------------------

export interface McuStats {
  /** доля времени, когда MCU не простаивал, 0..1 */
  awake?: number;
  /** среднее время выполнения задачи, с */
  taskAvg?: number;
  taskStddev?: number;
  bytesWrite?: number;
  bytesRead?: number;
  bytesRetransmit?: number;
  bytesInvalid?: number;
  sendSeq?: number;
  receiveSeq?: number;
  retransmitSeq?: number;
  /** сглаженный round-trip, с */
  srtt?: number;
  rttvar?: number;
  rto?: number;
  readyBytes?: number;
  upcomingBytes?: number;
  freq?: number;
}

const STAT_KEYS: Record<keyof McuStats, string> = {
  awake: 'mcu_awake',
  taskAvg: 'mcu_task_avg',
  taskStddev: 'mcu_task_stddev',
  bytesWrite: 'bytes_write',
  bytesRead: 'bytes_read',
  bytesRetransmit: 'bytes_retransmit',
  bytesInvalid: 'bytes_invalid',
  sendSeq: 'send_seq',
  receiveSeq: 'receive_seq',
  retransmitSeq: 'retransmit_seq',
  srtt: 'srtt',
  rttvar: 'rttvar',
  rto: 'rto',
  readyBytes: 'ready_bytes',
  upcomingBytes: 'upcoming_bytes',
  freq: 'freq',
};

export function parseLastStats(raw: unknown): McuStats {
  const out: McuStats = {};
  if (!raw || typeof raw !== 'object') return out;
  const rec = raw as Record<string, unknown>;
  for (const key of Object.keys(STAT_KEYS) as Array<keyof McuStats>) {
    const v = num(rec[STAT_KEYS[key]]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * Приращение накопительного счётчика. После рестарта MCU счётчик обнуляется
 * (cur < prev) — тогда база берётся заново, а не получается огромный минус.
 * null — если дельту посчитать нечем.
 */
export function counterDelta(prev: number | undefined, cur: number | undefined): number | null {
  if (prev === undefined || cur === undefined) return null;
  return cur >= prev ? cur - prev : 0;
}

// ------------------------------------------------------------------
// Шина CAN: объект `canbus_stats <mcu>`
// ------------------------------------------------------------------

export interface BusStats {
  /** active | warning | passive | off */
  state: string;
  rxError?: number;
  txError?: number;
  txRetries?: number;
}

export function parseCanbus(raw: unknown): BusStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.bus_state !== 'string') return null;
  const out: BusStats = { state: rec.bus_state };
  const rx = num(rec.rx_error);
  const tx = num(rec.tx_error);
  const rt = num(rec.tx_retries);
  if (rx !== undefined) out.rxError = rx;
  if (tx !== undefined) out.txError = tx;
  if (rt !== undefined) out.txRetries = rt;
  return out;
}

export function busStateSeverity(state: string | undefined): Severity {
  if (state === undefined) return 'unknown';
  if (state === 'active') return 'ok';
  if (state === 'warning') return 'warn';
  return 'crit'; // passive | off | неизвестное — шина не в рабочем состоянии
}

// ------------------------------------------------------------------
// Качество связи: скользящее окно приращений
// ------------------------------------------------------------------

export const LINK_WINDOW_SEC = 60;
/** Ниже этого числа повторно отправленных байт за окно шум не считаем (простой). */
export const MIN_RETRANSMIT_BYTES = 64;
export const RETRANSMIT_WARN_RATIO = 0.01;
export const RETRANSMIT_CRIT_RATIO = 0.05;
export const MCU_AWAKE_WARN = 0.85;

export interface LinkSample {
  t: number;
  write: number;
  retransmit: number;
  invalid: number;
  busErrors: number;
}

export interface LinkSnapshot {
  stats: McuStats;
  bus: BusStats | null;
}

export function linkSample(t: number, prev: LinkSnapshot | null, cur: LinkSnapshot): LinkSample {
  const zero: LinkSample = { t, write: 0, retransmit: 0, invalid: 0, busErrors: 0 };
  if (!prev) return zero;
  const busErrors =
    (counterDelta(prev.bus?.rxError, cur.bus?.rxError) ?? 0) +
    (counterDelta(prev.bus?.txError, cur.bus?.txError) ?? 0);
  return {
    t,
    write: counterDelta(prev.stats.bytesWrite, cur.stats.bytesWrite) ?? 0,
    retransmit: counterDelta(prev.stats.bytesRetransmit, cur.stats.bytesRetransmit) ?? 0,
    invalid: counterDelta(prev.stats.bytesInvalid, cur.stats.bytesInvalid) ?? 0,
    busErrors,
  };
}

export function pushLinkSample(
  window: LinkSample[],
  sample: LinkSample,
  windowSec = LINK_WINDOW_SEC,
): LinkSample[] {
  const cutoff = sample.t - windowSec;
  return [...window.filter((s) => s.t > cutoff), sample];
}

export type LinkReason = 'retransmit' | 'invalid' | 'highLoad' | 'busState' | 'busErrors';

export interface LinkStatus {
  severity: Severity;
  reasons: LinkReason[];
  /** доля повторно отправленных байт за окно, 0..1 */
  retransmitRatio: number;
}

export function mcuLinkStatus(
  window: LinkSample[],
  snap: { stats: McuStats; bus: BusStats | null } | null,
): LinkStatus {
  if (!snap) return { severity: 'unknown', reasons: [], retransmitRatio: 0 };

  let write = 0;
  let retransmit = 0;
  let invalid = 0;
  let busErrors = 0;
  for (const s of window) {
    write += s.write;
    retransmit += s.retransmit;
    invalid += s.invalid;
    busErrors += s.busErrors;
  }
  const ratio = write > 0 ? retransmit / write : 0;

  const reasons: LinkReason[] = [];
  let severity: Severity = 'ok';
  const raise = (to: Severity, reason: LinkReason) => {
    reasons.push(reason);
    severity = worstSeverity(severity, to);
  };

  if (retransmit >= MIN_RETRANSMIT_BYTES && ratio > RETRANSMIT_CRIT_RATIO) raise('crit', 'retransmit');
  else if (retransmit >= MIN_RETRANSMIT_BYTES && ratio > RETRANSMIT_WARN_RATIO) raise('warn', 'retransmit');

  if (invalid > 0) raise('warn', 'invalid');

  if (snap.bus) {
    const bs = busStateSeverity(snap.bus.state);
    if (bs === 'crit' || bs === 'warn') raise(bs, 'busState');
    if (busErrors > 0) raise('warn', 'busErrors');
  }

  if ((snap.stats.awake ?? 0) > MCU_AWAKE_WARN) raise('warn', 'highLoad');

  return { severity, reasons, retransmitRatio: ratio };
}

// ------------------------------------------------------------------
// Сводка для полосы здоровья и точки на вкладке
// ------------------------------------------------------------------

export interface HealthSummary {
  host: Severity;
  mcu: Severity;
  drivers: Severity;
  /** число MCU / драйверов с предупреждением или ошибкой */
  mcuIssues: number;
  driverIssues: number;
  /** все драйверы сейчас не опрашиваются (моторы выключены) */
  driversIdle: boolean;
  /** хоть что-то требует внимания */
  attention: boolean;
}

const isIssue = (s: Severity): boolean => s === 'warn' || s === 'crit';

export function summarize(input: {
  /** Klipper готов: иначе данные MCU/драйверов могут быть устаревшими */
  klippyReady: boolean;
  host: Severity;
  mcus: Severity[];
  drivers: Severity[];
  /** число драйверов, которые сейчас простаивают (мотор выключен) */
  driversIdle?: number;
}): HealthSummary {
  const mcu = input.klippyReady && input.mcus.length > 0 ? worstSeverity(...input.mcus) : 'unknown';
  const drivers =
    input.klippyReady && input.drivers.length > 0 ? worstSeverity(...input.drivers) : 'unknown';
  return {
    host: input.host,
    mcu,
    drivers,
    mcuIssues: input.klippyReady ? input.mcus.filter(isIssue).length : 0,
    driverIssues: input.klippyReady ? input.drivers.filter(isIssue).length : 0,
    driversIdle:
      input.klippyReady && input.drivers.length > 0 && (input.driversIdle ?? 0) === input.drivers.length,
    attention: isIssue(input.host) || isIssue(mcu) || isIssue(drivers),
  };
}

// ------------------------------------------------------------------
// Драйверы TMC: drv_status
// ------------------------------------------------------------------

export const TMC_ERROR_FLAGS: ReadonlySet<string> = new Set([
  'ot', 'otpw',
  's2ga', 's2gb', 's2vsa', 's2vsb',
  'ola', 'olb',
]);

export const TMC_CRITICAL_FLAGS: ReadonlySet<string> = new Set([
  'ot', 's2ga', 's2gb', 's2vsa', 's2vsb',
]);

/** Предупреждения о температуре драйвера (tmc2209 и др.). */
export const TMC_TEMP_FLAGS: ReadonlySet<string> = new Set(['t120', 't143', 't150', 't157']);

/** Флаг драйвера считается взведённым, если он не 0/false/null. */
export function isFlagSet(v: unknown): boolean {
  return v !== undefined && v !== null && v !== 0 && v !== false;
}

export interface DrvDecoded {
  /** false — drv_status не пришёл (драйвер не отвечает) */
  responding: boolean;
  /** взведённые аварийные флаги (TMC_ERROR_FLAGS) */
  errors: string[];
  /** подмножество `errors`, требующее остановки */
  critical: string[];
  /** предупреждения о температуре (t120…t157) */
  temp: string[];
  /** числовые поля (cs_actual, sg_result…) для вывода */
  values: Record<string, number>;
  severity: Severity;
}

export function decodeDrvStatus(raw: unknown): DrvDecoded {
  if (!raw || typeof raw !== 'object') {
    return { responding: false, errors: [], critical: [], temp: [], values: {}, severity: 'warn' };
  }
  const errors: string[] = [];
  const critical: string[] = [];
  const temp: string[] = [];
  const values: Record<string, number> = {};

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (TMC_ERROR_FLAGS.has(k)) {
      if (isFlagSet(v)) {
        errors.push(k);
        if (TMC_CRITICAL_FLAGS.has(k)) critical.push(k);
      }
    } else if (TMC_TEMP_FLAGS.has(k)) {
      if (isFlagSet(v)) temp.push(k);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      values[k] = v;
    }
  }

  let severity: Severity = 'ok';
  if (critical.length > 0) severity = 'crit';
  else if (errors.length > 0 || temp.length > 0) severity = 'warn';

  return { responding: true, errors, critical, temp, values, severity };
}

export interface TmcState {
  severity: Severity;
  /** драйвер не опрашивается: мотор выключен — это штатно, а не ошибка связи */
  idle: boolean;
  /** мотор включён, а драйвер молчит — вот это уже проблема */
  noResponse: boolean;
}

/**
 * Klipper читает drv_status, только пока мотор включён, и отдаёт `null`, когда он
 * выключен (после idle_timeout или до первого движения). Поэтому «нет ответа» —
 * ошибка лишь для включённого мотора; для выключенного (или неизвестного) это
 * нейтральное состояние «простаивает».
 */
export function tmcState(decoded: DrvDecoded, motorOn: boolean | null): TmcState {
  if (decoded.responding) return { severity: decoded.severity, idle: false, noResponse: false };
  if (motorOn === true) return { severity: 'warn', idle: false, noResponse: true };
  return { severity: 'unknown', idle: true, noResponse: false };
}
