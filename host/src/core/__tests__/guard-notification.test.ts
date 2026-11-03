import { describe, expect, it, vi } from 'vitest';

import { createGuardAgent, type GuardNotifyDetail } from '../guard-agent';
import { guardNotification } from '../guard-notification';
import { HOST_NOTIFICATION_SOURCE } from '../notification-center.svelte.ts';

const i18n = {
  t: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
};

const detail = (over: Partial<GuardNotifyDetail> = {}): GuardNotifyDetail => ({
  kind: 'denied',
  pluginId: 'acme',
  guardId: 'g',
  method: 'printer.restart',
  targetPrinterId: 'p2',
  ...over,
});

describe('guardNotification', () => {
  it('is an error from the host, attributed to the target printer', () => {
    const n = guardNotification(detail(), i18n);
    expect(n).toMatchObject({
      printerId: 'p2',
      pluginId: HOST_NOTIFICATION_SOURCE,
      severity: 'error',
      label: 'notifications.guard.source',
    });
  });

  it('picks the text by kind', () => {
    expect(guardNotification(detail({ kind: 'park_timeout' }), i18n).text).toBe(
      'notifications.guard.parkTimeout:{"method":"printer.restart"}',
    );
    expect(guardNotification(detail({ kind: 'decision_timeout' }), i18n).text).toBe(
      'notifications.guard.decisionTimeout:{"guard":"g","plugin":"acme","method":"printer.restart"}',
    );
    expect(guardNotification(detail(), i18n).text).toBe(
      'notifications.guard.denied:{"plugin":"acme","method":"printer.restart"}',
    );
  });

  it('a denial with a reasonKey shows the guard-provided reason', () => {
    expect(guardNotification(detail({ reasonKey: 'system.guard.print_in_progress' }), i18n).text).toBe(
      'system.guard.print_in_progress',
    );
  });
});

describe('guard agent notify sink', () => {
  async function timeout(agent: ReturnType<typeof createGuardAgent>) {
    agent.registerGuards('a', [{ id: 'slow', match: ['m'], handler: 'h' }], { h: () => new Promise(() => {}) });
    await agent.runPreflight('x', 'pA', 'm', undefined).catch(() => {});
  }

  it('delivers to the sink set later, and stops after it is cleared', async () => {
    const sink = vi.fn();
    const agent = createGuardAgent({ decisionTimeoutMs: 10 });
    await timeout(agent); // нет приёмника: событие молча теряется, без window-события
    expect(sink).not.toHaveBeenCalled();

    agent.setNotifySink(sink);
    await timeout(agent);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ kind: 'decision_timeout', targetPrinterId: 'pA' });

    agent.setNotifySink(null);
    await timeout(agent);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('a throwing sink does not break the guard chain', async () => {
    const agent = createGuardAgent({ decisionTimeoutMs: 10 });
    agent.setNotifySink(() => {
      throw new Error('boom');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    agent.registerGuards('a', [{ id: 'slow', match: ['m'], handler: 'h' }], { h: () => new Promise(() => {}) });
    const rejected = await agent.runPreflight('x', 'pA', 'm', undefined).then(() => null, (e) => e);
    expect(rejected?.rejection).toMatchObject({ code: 'guard_timeout' });
    err.mockRestore();
  });
});
