/**
 * Модель мониторинга без Svelte: разбирает дельты `printer.objects.subscribe`
 * (mcu / canbus_stats / tmc / toolhead) в готовые структуры, ведёт историю MCU
 * и окна приращений для оценки связи. Стор (`use-health.svelte.ts`) только
 * кладёт результат в реактивное состояние — всю логику можно проверить в Node.
 */
import {
  canbusMcuName,
  decodeDrvStatus,
  linkSample,
  matchCanbus,
  matchMcu,
  matchTmc,
  mcuLinkStatus,
  mcuShortName,
  parseCanbus,
  parseLastStats,
  parseTmcName,
  pushLinkSample,
  tmcState,
  type BusStats,
  type DrvDecoded,
  type LinkSample,
  type LinkSnapshot,
  type LinkStatus,
  type McuStats,
  type Severity,
} from './health-utils';

/** Точка истории MCU: уже в единицах для графиков. */
export interface McuPoint {
  t: number;
  /** загрузка MCU, % (mcu_awake × 100) */
  awake: number | null;
  /** среднее время задачи, мкс */
  taskUs: number | null;
  /** повторно отправленные байты, Б/с */
  retransBps: number | null;
  /** сглаженный round-trip, мс */
  srttMs: number | null;
}

export interface McuHealth {
  /** имя объекта Klipper: `mcu` / `mcu EBB` */
  name: string;
  /** `mcu` / `EBB` */
  short: string;
  version: string;
  build: string;
  freq: number | null;
  constants: Record<string, unknown> | null;
  /** сырой last_stats — для диалога деталей */
  rawStats: Record<string, unknown> | null;
  stats: McuStats;
  bus: BusStats | null;
  link: LinkStatus;
  history: McuPoint[];
}

export interface TmcDriver {
  name: string;
  type: string;
  stepper: string;
  decoded: DrvDecoded;
  /** включён ли мотор (stepper_enable); null — неизвестно */
  motorOn: boolean | null;
  /** итоговая оценка с учётом motorOn: выключенный мотор — не ошибка связи */
  severity: Severity;
  /** драйвер сейчас не опрашивается (мотор выключен) */
  idle: boolean;
  /** мотор включён, а драйвер не отвечает */
  noResponse: boolean;
  temperature: number | null;
  runCurrent: number | null;
  holdCurrent: number | null;
  /** флаг → когда в последний раз наблюдался за сессию (мс) */
  seen: Record<string, number>;
}

export const HEALTH_CAP = 600;

export const MCU_FIELDS = ['mcu_version', 'mcu_build_versions', 'mcu_constants', 'last_stats'];
export const CANBUS_FIELDS = ['bus_state', 'rx_error', 'tx_error', 'tx_retries'];
export const TMC_FIELDS = ['drv_status', 'temperature', 'run_current', 'hold_current'];
export const STEPPER_ENABLE_FIELDS = ['steppers'];

/**
 * После перезапуска Klipper связь с MCU устанавливается заново, и в этот момент
 * ретрансмиты и ошибки шины — штатное поведение, а не неисправность. Столько секунд
 * после возврата в ready связь не оценивается и уведомлений не вызывает.
 */
export const RESTART_QUIET_SEC = 30;

export const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

/** Внутренний учёт связи: предыдущий снимок и окно приращений. */
interface LinkTrack {
  prev: LinkSnapshot | null;
  window: LinkSample[];
  lastT: number;
}

export interface ApplyResult {
  mcus: McuHealth[] | null;
  tmc: TmcDriver[] | null;
  /** toolhead.stalls, если пришёл в дельте */
  stalls: number | null | undefined;
}

export function createHealthModel() {
  let mcus: McuHealth[] = [];
  let tmc: TmcDriver[] = [];
  const tracks = new Map<string, LinkTrack>();
  const buses = new Map<string, BusStats | null>();
  /** stepper → включён ли мотор */
  const enable = new Map<string, boolean>();
  /** до этого момента (сек, unix) приращения связи не накапливаются; Infinity — Klipper не готов */
  let quietUntil = 0;

  /** Связь пока не оценивается (рестарт Klipper): окно связи держим пустым, базу счётчиков обновляем. */
  function holdOff(untilSec: number): void {
    quietUntil = untilSec;
    for (const track of tracks.values()) track.window = [];
  }

  function applyMcu(name: string, rec: Record<string, unknown>, list: McuHealth[], t: number): void {
    const short = mcuShortName(name);
    const idx = list.findIndex((m) => m.name === name);
    const existing = idx >= 0 ? list[idx] : undefined;

    const constants =
      rec.mcu_constants && typeof rec.mcu_constants === 'object'
        ? (rec.mcu_constants as Record<string, unknown>)
        : (existing?.constants ?? null);
    const hasStats = !!rec.last_stats && typeof rec.last_stats === 'object';
    const rawStats = hasStats
      ? (rec.last_stats as Record<string, unknown>)
      : (existing?.rawStats ?? null);

    const stats = hasStats ? parseLastStats(rec.last_stats) : (existing?.stats ?? {});
    const bus = buses.get(short) ?? null;

    let track = tracks.get(short);
    if (!track) {
      track = { prev: null, window: [], lastT: t };
      tracks.set(short, track);
    }

    let history = existing?.history ?? [];
    if (hasStats) {
      const snap: LinkSnapshot = { stats, bus };
      const first = track.prev === null;
      const sample = linkSample(t, track.prev, snap);
      const dt = Math.max(0.5, t - track.lastT);
      track.window = t < quietUntil ? [] : pushLinkSample(track.window, sample);
      track.prev = snap;
      track.lastT = t;

      history = [
        ...history.slice(-(HEALTH_CAP - 1)),
        {
          t,
          awake: stats.awake !== undefined ? stats.awake * 100 : null,
          taskUs: stats.taskAvg !== undefined ? stats.taskAvg * 1e6 : null,
          retransBps: first ? null : sample.retransmit / dt,
          srttMs: stats.srtt !== undefined ? stats.srtt * 1000 : null,
        },
      ];
    }

    const build =
      typeof rec.mcu_build_versions === 'string'
        ? rec.mcu_build_versions
        : Array.isArray(rec.mcu_build_versions)
          ? rec.mcu_build_versions.join(', ')
          : (existing?.build ?? '');

    const model: McuHealth = {
      name,
      short,
      version: typeof rec.mcu_version === 'string' ? rec.mcu_version : (existing?.version ?? ''),
      build,
      freq: numOrNull((constants as { CLOCK_FREQ?: unknown } | null)?.CLOCK_FREQ) ?? stats.freq ?? null,
      constants,
      rawStats,
      stats,
      bus,
      link: mcuLinkStatus(track.window, { stats, bus }),
      history,
    };

    if (idx >= 0) list[idx] = model;
    else list.push(model);
  }

  function applyTmc(name: string, rec: Record<string, unknown>, list: TmcDriver[], now: number): void {
    const idx = list.findIndex((d) => d.name === name);
    const existing = idx >= 0 ? list[idx] : undefined;
    const { type, stepper } = parseTmcName(name);

    const decoded =
      'drv_status' in rec ? decodeDrvStatus(rec.drv_status) : (existing?.decoded ?? decodeDrvStatus(null));
    const seen = { ...(existing?.seen ?? {}) };
    for (const f of [...decoded.errors, ...decoded.temp]) seen[f] = now;

    const motorOn = enable.get(stepper) ?? null;
    const model: TmcDriver = {
      name,
      type,
      stepper,
      decoded,
      motorOn,
      ...tmcState(decoded, motorOn),
      temperature: 'temperature' in rec ? numOrNull(rec.temperature) : (existing?.temperature ?? null),
      runCurrent: 'run_current' in rec ? numOrNull(rec.run_current) : (existing?.runCurrent ?? null),
      holdCurrent: 'hold_current' in rec ? numOrNull(rec.hold_current) : (existing?.holdCurrent ?? null),
      seen,
    };

    if (idx >= 0) list[idx] = model;
    else list.push(model);
  }

  /** Перерасчёт состояния драйверов после смены stepper_enable. */
  function restate(list: TmcDriver[]): void {
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d) continue;
      const motorOn = enable.get(d.stepper) ?? null;
      list[i] = { ...d, motorOn, ...tmcState(d.decoded, motorOn) };
    }
  }

  /** `t` — секунды (unix), `nowMs` — для отметок «видели флаг». */
  function apply(delta: unknown, t: number, nowMs: number = t * 1000): ApplyResult {
    const result: ApplyResult = { mcus: null, tmc: null, stalls: undefined };
    if (!delta || typeof delta !== 'object') return result;
    const entries = Object.entries(delta as Record<string, unknown>);

    // шина раньше MCU: приращение ошибок считается по свежему состоянию шины
    for (const [name, raw] of entries) {
      if (!matchCanbus(name) || !raw || typeof raw !== 'object') continue;
      buses.set(canbusMcuName(name), parseCanbus(raw));
    }

    // включённость моторов — тоже раньше драйверов: от неё зависит смысл «нет ответа»
    let enableChanged = false;
    for (const [name, raw] of entries) {
      if (name !== 'stepper_enable' || !raw || typeof raw !== 'object') continue;
      const steppers = (raw as { steppers?: unknown }).steppers;
      if (!steppers || typeof steppers !== 'object') continue;
      for (const [stepper, on] of Object.entries(steppers as Record<string, unknown>)) {
        enable.set(stepper, !!on);
      }
      enableChanged = true;
    }

    const nextMcus = [...mcus];
    const nextTmc = [...tmc];
    let mcusChanged = false;
    let tmcChanged = false;

    for (const [name, raw] of entries) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;

      if (matchMcu(name)) {
        applyMcu(name, rec, nextMcus, t);
        mcusChanged = true;
      } else if (matchCanbus(name)) {
        const short = canbusMcuName(name);
        const i = nextMcus.findIndex((m) => m.short === short);
        const cur = i >= 0 ? nextMcus[i] : undefined;
        if (cur) {
          const bus = buses.get(short) ?? null;
          nextMcus[i] = {
            ...cur,
            bus,
            link: mcuLinkStatus(tracks.get(short)?.window ?? [], { stats: cur.stats, bus }),
          };
          mcusChanged = true;
        }
      } else if (matchTmc(name)) {
        applyTmc(name, rec, nextTmc, nowMs);
        tmcChanged = true;
      } else if (name === 'toolhead' && 'stalls' in rec) {
        result.stalls = numOrNull(rec.stalls);
      }
    }

    if (enableChanged && nextTmc.length > 0) {
      restate(nextTmc);
      tmcChanged = true;
    }

    if (mcusChanged) {
      mcus = nextMcus.sort(byName);
      result.mcus = mcus;
    }
    if (tmcChanged) {
      tmc = nextTmc.sort(byName);
      result.tmc = tmc;
    }
    return result;
  }

  /** Конфиг мог измениться: убираем объекты, которых больше нет. */
  function retain(known: ReadonlySet<string>): { mcus: McuHealth[]; tmc: TmcDriver[] } {
    mcus = mcus.filter((m) => known.has(m.name));
    tmc = tmc.filter((d) => known.has(d.name));
    for (const short of [...tracks.keys()]) {
      if (!mcus.some((m) => m.short === short)) {
        tracks.delete(short);
        buses.delete(short);
      }
    }
    return { mcus, tmc };
  }

  return {
    apply,
    retain,
    holdOff,
    get mcus() {
      return mcus;
    },
    get tmc() {
      return tmc;
    },
  };
}

export type HealthModel = ReturnType<typeof createHealthModel>;
