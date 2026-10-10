import { describe, expect, it, vi } from 'vitest';

import { createGuardAgent, GuardError, type GuardNotifyDetail } from '../guard-agent';

const flush = () => new Promise((r) => setTimeout(r, 0));

function agentWith(opts = {}) {
  return createGuardAgent({ newToken: (() => { let i = 0; return () => `t${++i}`; }), ...opts });
}

describe('guard-agent', () => {
  it('passes through when no guards match', async () => {
    const agent = agentWith();
    await expect(agent.runPreflight('p1', 'printer.print.start', { filename: 'a' })).resolves.toBeUndefined();
  });

  it('runs chain in registration order, glob matchers work', async () => {
    const agent = agentWith();
    const order: string[] = [];
    agent.registerGuards('a', [{ id: 'g1', match: ['printer.print.start'], handler: 'h' }], {
      h: () => { order.push('g1'); return { action: 'allow' }; },
    });
    agent.registerGuards('b', [{ id: 'g2', match: ['printer.*'], handler: 'h' }], {
      h: () => { order.push('g2'); return { action: 'allow' }; },
    });
    await agent.runPreflight('x', 'printer.print.start', undefined);
    expect(order).toEqual(['g1', 'g2']);

    order.length = 0;
    await agent.runPreflight('x', 'server.info', undefined);
    expect(order).toEqual([]);
  });

  it('skips initiator own guards (anti-recursion)', async () => {
    const agent = agentWith();
    const h = vi.fn(() => ({ action: 'allow' as const }));
    agent.registerGuards('a', [{ id: 'g1', match: ['m'], handler: 'h' }], { h });
    await agent.runPreflight('a', 'm', undefined);
    expect(h).not.toHaveBeenCalled();
  });

  it('deny rejects with attribution and stops the chain', async () => {
    const agent = agentWith();
    const second = vi.fn(() => ({ action: 'allow' as const }));
    agent.registerGuards('a', [{ id: 'g1', match: ['m'], handler: 'h' }], {
      h: () => ({ action: 'deny', reasonKey: 'mmu.map' }),
    });
    agent.registerGuards('b', [{ id: 'g2', match: ['m'], handler: 'h' }], { h: second });

    const err = await agent.runPreflight('x', 'm', undefined).then(
      () => null,
      (e) => e as GuardError,
    );
    expect(err).toBeInstanceOf(GuardError);
    expect(err!.rejection).toMatchObject({ code: 'denied_by_guard', pluginId: 'a', guardId: 'g1', reasonKey: 'mmu.map' });
    expect(second).not.toHaveBeenCalled();
  });

    it('freeze parks; identical request → already_pending; resume accept continues', async () => {
    const agent = agentWith();
    let token: string | null = null;
    let freezeCalls = 0;
    const after = vi.fn(() => ({ action: 'allow' as const }));
    agent.registerGuards('a', [{ id: 'f', match: ['m'], handler: 'f' }], {
      f: (_req: unknown, tok: string) => {
        freezeCalls++;
        // морозим только первый запрос: иначе «не-дубль» тоже припаркуется навсегда
        if (freezeCalls === 1) {
          token = tok;
          return { action: 'freeze' };
        }
        return { action: 'allow' };
      },
    });
    agent.registerGuards('b', [{ id: 'after', match: ['m'], handler: 'after' }], { after });

    let settled = false;
    const p = agent.runPreflight('x', 'm', { v: 1 }).then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    expect(agent.getParkedChains()).toHaveLength(1);

    await expect(agent.runPreflight('x', 'm', { v: 1 })).rejects.toMatchObject({
      rejection: { code: 'already_pending' },
    });

    // другие params — не дубль: цепочка проходит насквозь (f уже allow)
    await agent.runPreflight('x', 'm', { v: 2 });

    agent.resume(token!, 'accept');
    await p;
    expect(settled).toBe(true);
    // after вызван дважды: цепочка {v:2} и возобновлённая цепочка {v:1}
    expect(after).toHaveBeenCalledTimes(2);
    expect(agent.getParkedChains()).toHaveLength(0);
  });

  it('resume deny rejects with frozen-guard attribution', async () => {
    const agent = agentWith();
    let token = '';
    agent.registerGuards('a', [{ id: 'f', match: ['m'], handler: 'f' }], {
      f: (_r: unknown, tok: string) => { token = tok; return { action: 'freeze' }; },
    });
    const p = agent.runPreflight('x', 'm', undefined);
    await flush();
    agent.resume(token, 'deny', 'user.cancel');
    const err = await p.then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'denied_by_guard', pluginId: 'a', reasonKey: 'user.cancel' });
  });

    it('handler decision timeout → guard_timeout + notify sink', async () => {
    const events: GuardNotifyDetail[] = [];
    const agent = agentWith({
      decisionTimeoutMs: 15,
      onNotify: (d) => events.push(d),
    });
    agent.registerGuards('a', [{ id: 'slow', match: ['m'], handler: 'h' }], {
      h: () => new Promise(() => {}),
    });
    const err = await agent.runPreflight('x', 'm', undefined).then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'guard_timeout', pluginId: 'a' });
    expect(events).toEqual([
      { kind: 'decision_timeout', pluginId: 'a', guardId: 'slow', method: 'm' },
    ]);
  });

  it('park timeout → guard_timeout + notify sink', async () => {
    const events: GuardNotifyDetail[] = [];
    const agent = agentWith({
      parkTimeoutMs: 15,
      onNotify: (d) => events.push(d),
    });
    agent.registerGuards('a', [{ id: 'f', match: ['m'], handler: 'f' }], {
      f: () => ({ action: 'freeze' }),
    });
    const p = agent.runPreflight('x', 'm', undefined);
    await flush();
    expect(agent.getParkedChains()).toHaveLength(1);
    const err = await p.then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'guard_timeout' });
    expect(agent.getParkedChains()).toHaveLength(0);
    expect(events).toEqual([
      { kind: 'park_timeout', pluginId: 'a', guardId: 'f', method: 'm' },
    ]);
  });

  it('park timeout → guard_timeout', async () => {
    const agent = agentWith({ parkTimeoutMs: 15 });
    agent.registerGuards('a', [{ id: 'f', match: ['m'], handler: 'f' }], {
      f: () => ({ action: 'freeze' }),
    });
    const p = agent.runPreflight('x', 'm', undefined);
    await flush();
    expect(agent.getParkedChains()).toHaveLength(1);
    const err = await p.then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'guard_timeout' });
    expect(agent.getParkedChains()).toHaveLength(0);
  });

  it('unregister denies parked chains of the plugin', async () => {
    const agent = agentWith();
    agent.registerGuards('a', [{ id: 'f', match: ['m'], handler: 'f' }], {
      f: () => ({ action: 'freeze' }),
    });
    const p = agent.runPreflight('x', 'm', undefined);
    await flush();
    agent.unregisterGuards('a');
    const err = await p.then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'denied_by_guard', pluginId: 'a' });
    expect(agent.getRegisteredGuards()).toHaveLength(0);
  });

  it('resume with unknown token is a no-op', () => {
    const agent = agentWith();
    expect(() => agent.resume('nope', 'accept')).not.toThrow();
  });
});