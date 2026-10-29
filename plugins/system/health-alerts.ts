/**
 * Детекторы уведомлений о здоровье принтера: троттлинг хоста, связь с MCU, шина CAN.
 * Чистая логика без i18n и Svelte — агрегатор уведомлений превращает события в тексты.
 *
 * Живёт отдельно от стора страницы: уведомления должны приходить и тогда, когда
 * страница «Система» не открыта (так же устроены уведомления TMC).
 */
import { createHealthModel, RESTART_QUIET_SEC } from './health-model';
import {
  parseThrottled,
  type LinkReason,
  type LinkStatus,
  type ThrottleFlag,
  type ThrottleState,
} from './health-utils';

export type AlertSeverity = 'critical' | 'error';

export type HealthAlert =
  | { kind: 'throttle'; flag: ThrottleFlag; severity: AlertSeverity; sticky: boolean }
  | { kind: 'mcuLink'; mcu: string; reason: LinkReason; severity: AlertSeverity; sticky: boolean }
  | { kind: 'canbus'; mcu: string; state: string; severity: AlertSeverity; sticky: boolean };

/** Причины, о которых уведомляем. `busState` идёт отдельным событием, `highLoad` шумит. */
const NOTIFIED_REASONS: ReadonlySet<LinkReason> = new Set(['retransmit', 'invalid', 'busErrors']);

/** Пониженное напряжение и троттлинг — критичны: качество печати под угрозой. */
const CRITICAL_THROTTLE: ReadonlySet<ThrottleFlag> = new Set(['undervoltage', 'throttled']);

export function diffThrottle(prev: ThrottleState | null, cur: ThrottleState): HealthAlert[] {
  if (!cur.supported) return [];
  const before = new Set(prev?.now ?? []);
  return cur.now
    .filter((flag) => !before.has(flag))
    .map((flag): HealthAlert => {
      const critical = CRITICAL_THROTTLE.has(flag);
      return { kind: 'throttle', flag, severity: critical ? 'critical' : 'error', sticky: critical };
    });
}

export function diffMcuLink(mcu: string, prev: LinkStatus | null, cur: LinkStatus): HealthAlert[] {
  const before = new Set(prev?.reasons ?? []);
  return cur.reasons
    .filter((r) => NOTIFIED_REASONS.has(r) && !before.has(r))
    .map((reason): HealthAlert => {
      // сильные ретрансмиты (>5%) — критично, остальное — ошибка
      const critical = reason === 'retransmit' && cur.severity === 'crit';
      return { kind: 'mcuLink', mcu, reason, severity: critical ? 'critical' : 'error', sticky: critical };
    });
}

/** Шина CAN перешла в нерабочее состояние (warning / passive / off). */
export function diffBusState(mcu: string, prev: string | undefined, cur: string | undefined): HealthAlert[] {
  if (cur === undefined || cur === 'active' || cur === prev) return [];
  const critical = cur !== 'warning';
  return [{ kind: 'canbus', mcu, state: cur, severity: critical ? 'critical' : 'error', sticky: critical }];
}

/**
 * Антидребезг: одно и то же событие не чаще раза в `gapMs`.
 * Ретрансмиты и состояния шины флапают — без этого уведомления сыпались бы шквалом.
 */
export function createAlertGate(now: () => number = Date.now) {
  const last = new Map<string, number>();
  return {
    allow(key: string, gapMs: number): boolean {
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < gapMs) return false;
      last.set(key, t);
      return true;
    },
    clear(): void {
      last.clear();
    },
  };
}

export const MCU_ALERT_GAP_MS = 60_000;
export const THROTTLE_ALERT_GAP_MS = 5 * 60_000;

function alertKey(a: HealthAlert): string {
  switch (a.kind) {
    case 'throttle':
      return `throttle:${a.flag}`;
    case 'mcuLink':
      return `mcuLink:${a.mcu}:${a.reason}`;
    case 'canbus':
      return `canbus:${a.mcu}:${a.state}`;
  }
}

/**
 * Наблюдатель одного принтера: получает дельты объектов и троттлинг, возвращает
 * новые события. Состояние (предыдущие статусы, шлюз) хранит у себя.
 */
export function createHealthWatch(now: () => number = Date.now) {
  const model = createHealthModel();
  const links = new Map<string, LinkStatus>();
  const buses = new Map<string, string | undefined>();
  let throttle: ThrottleState | null = null;
  const gate = createAlertGate(now);

  // Рестарт Klipper: MCU переподключается, и пачка ретрансмитов / сбой шины в этот
  // момент — штатное поведение. Пока Klipper не готов и ещё RESTART_QUIET_SEC после
  // возврата в ready связь не оцениваем. Троттлинг хоста от этого не зависит.
  let klippyUp = true;
  let quietUntilMs = 0;

  function klippyReady(ready: boolean): void {
    klippyUp = ready;
    quietUntilMs = ready ? now() + RESTART_QUIET_SEC * 1000 : Infinity;
    model.holdOff(quietUntilMs / 1000);
  }

  const quiet = (): boolean => !klippyUp || now() < quietUntilMs;

  function filter(alerts: HealthAlert[]): HealthAlert[] {
    return alerts.filter((a) =>
      gate.allow(alertKey(a), a.kind === 'throttle' ? THROTTLE_ALERT_GAP_MS : MCU_ALERT_GAP_MS),
    );
  }

  /** Дельта подписки на mcu* / canbus_stats*. `t` — секунды (unix). */
  function onDelta(delta: unknown, t: number = now() / 1000): HealthAlert[] {
    const res = model.apply(delta, t);
    if (!res.mcus) return [];
    // прежние статусы не обновляем: проблема, пережившая «тихое» окно, всё равно
    // будет замечена как новая сразу после него
    if (quiet()) return [];

    const out: HealthAlert[] = [];
    for (const mcu of res.mcus) {
      out.push(...diffMcuLink(mcu.short, links.get(mcu.short) ?? null, mcu.link));
      out.push(...diffBusState(mcu.short, buses.get(mcu.short), mcu.bus?.state));
      links.set(mcu.short, mcu.link);
      buses.set(mcu.short, mcu.bus?.state);
    }
    return filter(out);
  }

  /** Сырое throttled_state: из proc_stats / notify_cpu_throttled / notify_proc_stat_update. */
  function onThrottle(raw: unknown): HealthAlert[] {
    const cur = parseThrottled(raw);
    const alerts = diffThrottle(throttle, cur);
    throttle = cur;
    return filter(alerts);
  }

  /** После пересчёта списка объектов: забыть то, чего больше нет в конфиге. */
  function retain(known: ReadonlySet<string>): void {
    const kept = model.retain(known);
    const shorts = new Set(kept.mcus.map((m) => m.short));
    for (const k of [...links.keys()]) if (!shorts.has(k)) links.delete(k);
    for (const k of [...buses.keys()]) if (!shorts.has(k)) buses.delete(k);
  }

  return { onDelta, onThrottle, retain, klippyReady };
}

export type HealthWatch = ReturnType<typeof createHealthWatch>;
