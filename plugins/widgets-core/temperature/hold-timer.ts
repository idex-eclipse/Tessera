/**
 * Таймер «время включения нагревателя»: после достижения цели держим нагрев
 * заданное время и выключаем. Чистая машина состояний — часы и данные
 * приходят снаружи, DOM и Klipper не нужны.
 *
 * off     — не взведён (нет цели / таймер не задан / идёт печать);
 * heating — цель задана, ждём её достижения;
 * holding — цель достигнута, идёт отсчёт;
 * done    — время вышло, команда выключения отправлена; защёлка до смены цели,
 *           иначе таймер взвёлся бы заново, пока цель ещё не обнулилась.
 */
export type HoldPhase = 'off' | 'heating' | 'holding' | 'done';

export interface HoldState {
  phase: HoldPhase;
  armedTarget: number;
  startedAt: number;
}

export interface HoldInput {
  target: number | null;
  temperature: number | null;
  /** 0 — таймер не задан */
  minutes: number;
  /** печать идёт — нагреватель трогать нельзя */
  blocked: boolean;
  now: number;
}

export const HOLD_MAX_MINUTES = 1440;

/**
 * Разбор поля «минуты»: пусто → 0 (таймер выключен), число → ограничено HOLD_MAX_MINUTES,
 * не число / отрицательное → null (ввод невалиден).
 */
export function parseHoldMinutes(raw: string | number | null | undefined): number | null {
  const text = String(raw ?? '').trim();
  if (text === '') return 0;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, HOLD_MAX_MINUTES);
}

/** Допуск «цель достигнута», °C: ПИД колеблется возле цели */
export const REACHED_TOLERANCE = 2;

export const HOLD_OFF: HoldState = { phase: 'off', armedTarget: 0, startedAt: 0 };

export function stepHold(state: HoldState, i: HoldInput): { state: HoldState; fire: boolean } {
  const target = i.target ?? 0;
  if (i.minutes <= 0 || i.blocked || target <= 0) return { state: HOLD_OFF, fire: false };

  let s = state;
  // новая цель (или первое взведение) — начинаем с нагрева
  if (s.phase === 'off' || s.armedTarget !== target) {
    s = { phase: 'heating', armedTarget: target, startedAt: 0 };
  }

  if (
    s.phase === 'heating' &&
    i.temperature != null &&
    i.temperature >= target - REACHED_TOLERANCE
  ) {
    s = { ...s, phase: 'holding', startedAt: i.now };
  }

  if (s.phase === 'holding' && i.now >= s.startedAt + i.minutes * 60_000) {
    return { state: { ...s, phase: 'done' }, fire: true };
  }

  return { state: s, fire: false };
}

/** Сколько мс осталось до выключения; null — отсчёт не идёт */
export function holdRemainingMs(state: HoldState, minutes: number, now: number): number | null {
  if (state.phase !== 'holding' || minutes <= 0) return null;
  return Math.max(0, state.startedAt + minutes * 60_000 - now);
}

/** 125000 мс → «2:05» */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function sameHold(a: HoldState, b: HoldState): boolean {
  return a.phase === b.phase && a.armedTarget === b.armedTarget && a.startedAt === b.startedAt;
}
