import { describe, expect, it, vi } from 'vitest';

import { createGuardAgent, GuardError, type GuardAgentOptions, type GuardNotifyDetail, type GuardRequest } from '../guard-agent';

const flush = () => new Promise((r) => setTimeout(r, 0));

function agentWith(opts: GuardAgentOptions = {}) {
  let i = 0;
  return createGuardAgent({ newToken: () => `t${++i}`, ...opts });
}

describe('guard-agent', () => {
  it('passes through when no guards match', async () => {
    const agent = agentWith();
    await expect(agent.runPreflight('p1', 'pA', 'printer.print.start', { filename: 'a' })).resolves.toBeUndefined();
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
    await agent.runPreflight('x', 'pA', 'printer.print.start', undefined);
    expect(order).toEqual(['g1', 'g2']);

    order.length = 0;
    await agent.runPreflight('x', 'pA', 'server.info', undefined);
    expect(order).toEqual([]);
  });

  it('runs the initiator own guard in registration order', async () => {
    const agent = agentWith();
    const order: string[] = [];
    agent.registerGuards('a', [{ id: 'g1', match: ['m'], handler: 'h' }], {
      h: () => { order.push('a'); return { action: 'allow' }; },
    });
    agent.registerGuards('b', [{ id: 'g2', match: ['m'], handler: 'h' }], {
      h: () => { order.push('b'); return { action: 'allow' }; },
    });
    await agent.runPreflight('a', 'pA', 'm', undefined);
    expect(order).toEqual(['a', 'b']);
  });

  it('skips an active guard for its own async nested request', async () => {
    const agent = agentWith();
    const own = vi.fn(async () => {
      // The nested request happens after an await, while the first decision is pending.
      await Promise.resolve();
      await agent.runPreflight('a', 'pA', 'm', undefined);
      return { action: 'allow' as const };
    });
    const other = vi.fn(() => ({ action: 'allow' as const }));
    agent.registerGuards('a', [{ id: 'g1', match: ['m'], handler: 'h' }], { h: own });
    agent.registerGuards('b', [{ id: 'g2', match: ['m'], handler: 'h' }], { h: other });

    await agent.runPreflight('a', 'pA', 'm', undefined);
    expect(own).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it('denies cross-plugin re-entry into an active guard', async () => {
    const agent = agentWith();
    let nestedError: GuardError | null = null;
    const own = vi.fn(async () => {
      await agent.runPreflight('a', 'pA', 'nested', undefined);
      return { action: 'allow' as const };
    });
    const other = vi.fn(async () => {
      // B's request would call A again unless the host stops the cycle.
      nestedError = await agent.runPreflight('b', 'pA', 'outer', undefined).then(
        () => null,
        (error) => error as GuardError,
      );
      return { action: 'allow' as const };
    });
    agent.registerGuards('a', [{ id: 'g1', match: ['outer'], handler: 'h' }], { h: own });
    agent.registerGuards('b', [{ id: 'g2', match: ['nested'], handler: 'h' }], { h: other });

    await agent.runPreflight('a', 'pA', 'outer', undefined);
    expect(own).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(nestedError).toBeInstanceOf(GuardError);
    expect(nestedError!.rejection).toMatchObject({ code: 'denied_by_guard', pluginId: 'a', guardId: 'g1' });
  });

  it('deny rejects with attribution and stops the chain', async () => {
    const agent = agentWith();
    const second = vi.fn(() => ({ action: 'allow' as const }));
    agent.registerGuards('a', [{ id: 'g1', match: ['m'], handler: 'h' }], {
      h: () => ({ action: 'deny', reasonKey: 'mmu.map' }),
    });
    agent.registerGuards('b', [{ id: 'g2', match: ['m'], handler: 'h' }], { h: second });

    const err = await agent.runPreflight('a', 'pA', 'm', undefined).then(
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
    const p = agent.runPreflight('a', 'pA', 'm', { v: 1 }).then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    expect(agent.getParkedChains()).toHaveLength(1);

    await expect(agent.runPreflight('a', 'pA', 'm', { v: 1 })).rejects.toMatchObject({
      rejection: { code: 'already_pending' },
    });

    // другие params — не дубль: цепочка проходит насквозь (f уже allow)
    await agent.runPreflight('a', 'pA', 'm', { v: 2 });

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
    const p = agent.runPreflight('x', 'pA', 'm', undefined);
    await flush();
    agent.resume(token, 'deny', 'user.cancel');
    const err = await p.then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'denied_by_guard', pluginId: 'a', reasonKey: 'user.cancel' });
  });

  it('parks identical requests independently for two target printers', async () => {
    const agent = agentWith();
    const tokens = new Map<string, string>();
    agent.registerGuards('guard', [{ id: 'freeze', match: ['m'], handler: 'h' }], {
      h: (request: GuardRequest, token: string, ctx: { targetPrinterId: string }) => {
        expect(request.targetPrinterId).toBe(ctx.targetPrinterId);
        tokens.set(ctx.targetPrinterId, token);
        return { action: 'freeze' };
      },
    });
    const a = agent.runPreflight('caller', 'pA', 'm', { value: 1 });
    // Let the first handler finish freezing before another caller reaches this guard.
    await flush();
    expect(agent.getParkedChains()).toHaveLength(1);
    const b = agent.runPreflight('caller', 'pB', 'm', { value: 1 });
    await flush();
    expect(agent.getParkedChains()).toHaveLength(2);
    agent.resume(tokens.get('pA')!, 'accept');
    await expect(a).resolves.toBeUndefined();
    expect(agent.getParkedChains()).toHaveLength(1);
    agent.resume(tokens.get('pB')!, 'deny');
    await expect(b).rejects.toMatchObject({ rejection: { code: 'denied_by_guard' } });
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
    const err = await agent.runPreflight('x', 'pA', 'm', undefined).then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'guard_timeout', pluginId: 'a' });
    expect(events).toEqual([
      { kind: 'decision_timeout', pluginId: 'a', guardId: 'slow', method: 'm', targetPrinterId: 'pA' },
    ]);
  });

  it('late settlement after timeout does not clear a newer active call', async () => {
    const agent = agentWith({ decisionTimeoutMs: 100 });
    const finish: Array<() => void> = [];
    agent.registerGuards('a', [{ id: 'slow', match: ['m'], handler: 'h' }], {
      h: () => new Promise<{ action: 'allow' }>((resolve) => {
        finish.push(() => resolve({ action: 'allow' }));
      }),
    });

    await expect(agent.runPreflight('a', 'pA', 'm', undefined)).rejects.toMatchObject({
      rejection: { code: 'guard_timeout' },
    });
    const current = agent.runPreflight('a', 'pA', 'm', undefined);
    finish[0]!();
    await Promise.resolve();

    // The first handler's late answer must not expose the second active handler.
    await expect(agent.runPreflight('b', 'pA', 'm', undefined)).rejects.toMatchObject({
      rejection: { code: 'denied_by_guard', pluginId: 'a', guardId: 'slow' },
    });
    finish[1]!();
    await expect(current).resolves.toBeUndefined();
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
    const p = agent.runPreflight('x', 'pA', 'm', undefined);
    await flush();
    expect(agent.getParkedChains()).toHaveLength(1);
    const err = await p.then(() => null, (e) => e as GuardError);
    expect(err!.rejection).toMatchObject({ code: 'guard_timeout' });
    expect(agent.getParkedChains()).toHaveLength(0);
    expect(events).toEqual([
      { kind: 'park_timeout', pluginId: 'a', guardId: 'f', method: 'm', targetPrinterId: 'pA' },
    ]);
  });

  it('park timeout → guard_timeout', async () => {
    const agent = agentWith({ parkTimeoutMs: 15 });
    agent.registerGuards('a', [{ id: 'f', match: ['m'], handler: 'f' }], {
      f: () => ({ action: 'freeze' }),
    });
    const p = agent.runPreflight('x', 'pA', 'm', undefined);
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
    const p = agent.runPreflight('x', 'pA', 'm', undefined);
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
