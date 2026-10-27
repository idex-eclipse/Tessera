import { describe, expect, it } from 'vitest';

import {
  formatCountdown,
  HOLD_OFF,
  holdRemainingMs,
  stepHold,
  type HoldInput,
  type HoldState,
} from './hold-timer';

const base: HoldInput = { target: 220, temperature: 25, minutes: 5, blocked: false, now: 0 };
const run = (s: HoldState, patch: Partial<HoldInput>) => stepHold(s, { ...base, ...patch });

describe('stepHold', () => {
  it('stays off without a target, without minutes, or during a print', () => {
    expect(run(HOLD_OFF, { target: 0 }).state).toEqual(HOLD_OFF);
    expect(run(HOLD_OFF, { target: null }).state).toEqual(HOLD_OFF);
    expect(run(HOLD_OFF, { minutes: 0 }).state).toEqual(HOLD_OFF);
    expect(run(HOLD_OFF, { blocked: true }).state).toEqual(HOLD_OFF);
  });

  it('waits for the target, then counts down and fires once', () => {
    let s = run(HOLD_OFF, {}).state;
    expect(s.phase).toBe('heating');

    expect(run(s, { temperature: 217, now: 500 }).state.phase).toBe('heating'); // ещё вне допуска
    s = run(s, { temperature: 218, now: 1000 }).state; // на границе допуска
    expect(s).toMatchObject({ phase: 'holding', startedAt: 1000 });

    expect(run(s, { temperature: 220, now: 1000 + 299_000 }).fire).toBe(false);

    const end = run(s, { temperature: 220, now: 1000 + 300_000 });
    expect(end.fire).toBe(true);
    expect(end.state.phase).toBe('done');

    // защёлка: пока цель не обнулилась, повторно не стреляем и не взводимся
    const again = run(end.state, { temperature: 220, now: 1000 + 301_000 });
    expect(again.fire).toBe(false);
    expect(again.state.phase).toBe('done');
  });

  it('resets when the heater is switched off after firing', () => {
    const done: HoldState = { phase: 'done', armedTarget: 220, startedAt: 0 };
    expect(run(done, { target: 0 }).state).toEqual(HOLD_OFF);
  });

  it('a new target restarts the heating phase', () => {
    const holding: HoldState = { phase: 'holding', armedTarget: 220, startedAt: 1000 };
    const s = run(holding, { target: 250, temperature: 220, now: 5000 }).state;
    expect(s).toMatchObject({ phase: 'heating', armedTarget: 250 });
  });

  it('a print start cancels a running timer', () => {
    const holding: HoldState = { phase: 'holding', armedTarget: 220, startedAt: 1000 };
    const res = run(holding, { blocked: true, now: 10 * 60_000 });
    expect(res.state).toEqual(HOLD_OFF);
    expect(res.fire).toBe(false);
  });

  it('changing minutes while holding keeps the start time', () => {
    const holding: HoldState = { phase: 'holding', armedTarget: 220, startedAt: 0 };
    expect(run(holding, { minutes: 1, now: 59_000 }).fire).toBe(false);
    expect(run(holding, { minutes: 1, now: 60_000 }).fire).toBe(true);
  });

  it('already hot heater starts holding right away', () => {
    const s = run(HOLD_OFF, { temperature: 220, now: 42 }).state;
    expect(s).toMatchObject({ phase: 'holding', startedAt: 42 });
  });
});

describe('holdRemainingMs / formatCountdown', () => {
  it('remaining only while holding', () => {
    const holding: HoldState = { phase: 'holding', armedTarget: 220, startedAt: 1000 };
    expect(holdRemainingMs(holding, 1, 1000 + 15_000)).toBe(45_000);
    expect(holdRemainingMs(holding, 1, 1000 + 90_000)).toBe(0);
    expect(holdRemainingMs({ ...holding, phase: 'heating' }, 1, 0)).toBeNull();
  });

  it('formats m:ss', () => {
    expect(formatCountdown(125_000)).toBe('2:05');
    expect(formatCountdown(500)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
  });
});
