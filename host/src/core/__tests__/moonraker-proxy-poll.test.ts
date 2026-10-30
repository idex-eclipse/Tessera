import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockWebSocket } from './mock-websocket';

import {
  clearMoonrakerProxyPool,
  createMoonrakerProxy,
  type MoonrakerProxy,
  type WebSocketFactory,
} from '../moonraker-proxy';

function createWsFactory(): {
  instances: MockWebSocket[];
  factory: WebSocketFactory;
} {
  const instances: MockWebSocket[] = [];

  const factory: WebSocketFactory = (url) => {
    const ws = new MockWebSocket(url);
    instances.push(ws);
    return ws;
  };

  return { instances, factory };
}

function last(instances: MockWebSocket[]): MockWebSocket {
  const ws = instances[instances.length - 1];
  if (!ws) throw new Error('No MockWebSocket instance was created');
  return ws;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function stubAuthProbeOk(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })),
  );
}

async function waitForSocket(
  instances: MockWebSocket[],
  index = 0,
): Promise<MockWebSocket> {
  for (let i = 0; i < 100; i++) {
    const ws = instances[index];
    if (ws) return ws;
    await Promise.resolve();
  }
  throw new Error(`Socket #${index} was not created`);
}

async function openProxy(
  instances: MockWebSocket[],
  factory: WebSocketFactory,
): Promise<MoonrakerProxy> {
  const proxy = createMoonrakerProxy('http://printer.local', {
    WebSocket: factory,
    baseReconnectDelay: 10_000,
  });

  (await waitForSocket(instances)).simulateOpen();

  return proxy;
}

function respondLast(ws: MockWebSocket, result: unknown): void {
  ws.respond(ws.lastSentMessage()!.id as number, result);
}

beforeEach(() => {
  stubAuthProbeOk();
});

afterEach(() => {
  clearMoonrakerProxyPool();
  MockWebSocket.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MoonrakerProxy / poll', () => {
  it('MP-POLL-01: first tick immediate, then periodic; interval clamped to 250ms', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const sentBefore = ws.sentMessages.length;

      proxy.handle.poll('printer.info', undefined, 1000);
      await flushMicrotasks();

      // первый тик сразу при регистрации
      expect(ws.sentMessages.length).toBe(sentBefore + 1);
      expect(ws.lastSentMessage()?.method).toBe('printer.info');
      respondLast(ws, { state: 'ready' });
      await flushMicrotasks(); // снимает inFlight до следующего тика

      vi.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sentBefore + 2);
      respondLast(ws, { state: 'ready' });
      await flushMicrotasks();

      // clamp: 50ms → 250ms
      const unreg2 = proxy.handle.poll('server.info', undefined, 50);
      await flushMicrotasks();
      const sentAfterReg = ws.sentMessages.length; // +1 первый тик server.info
      respondLast(ws, {});
      await flushMicrotasks(); // снимает inFlight

      vi.advanceTimersByTime(249);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sentAfterReg);

      vi.advanceTimersByTime(1);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sentAfterReg + 1);

      unreg2();
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });

  it('MP-POLL-02: refuses side-effect methods with console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const sentBefore = ws.sentMessages.length;

      const unreg = proxy.handle.poll('printer.emergency_stop', undefined, 1000);
      await flushMicrotasks();

      expect(ws.sentMessages.length).toBe(sentBefore);
      expect(warnSpy).toHaveBeenCalled();
      unreg();
    } finally {
      proxy.dispose();
      warnSpy.mockRestore();
    }
  });

  it('MP-POLL-03: min-interval across registrations; no immediate tick on re-register', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const sent0 = ws.sentMessages.length;

      const unregA = proxy.handle.poll('printer.info', undefined, 2000);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sent0 + 1); // первый тик A
      respondLast(ws, { state: 'ready' });

      const unregB = proxy.handle.poll('printer.info', undefined, 500);
      await flushMicrotasks();
      // existing schedule: интервал сменился на 500, но immediate-тик не дублируется
      expect(ws.sentMessages.length).toBe(sent0 + 1);

      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sent0 + 2); // min-interval 500
      respondLast(ws, { state: 'ready' });

      unregB();
      const sentAfterUnregB = ws.sentMessages.length;

      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sentAfterUnregB); // снова 2000

      vi.advanceTimersByTime(1500);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sentAfterUnregB + 1);

      unregA();
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });

  it('MP-POLL-04: last unregister stops polling', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const unreg = proxy.handle.poll('printer.info', undefined, 500);
      await flushMicrotasks();
      respondLast(ws, { state: 'ready' });

      const sentAfterReg = ws.sentMessages.length;

      unreg();

      vi.advanceTimersByTime(1500);
      await flushMicrotasks();

      expect(ws.sentMessages.length).toBe(sentAfterReg);
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });

  it('MP-POLL-05: pollTick refreshes snapshot cache; request() reads fresh without extra send', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const p1 = proxy.handle.request('printer.info');
      respondLast(ws, { state: 'error', state_message: 'old' });
      await expect(p1).resolves.toEqual({ state: 'error', state_message: 'old' });

      const sentAfterP1 = ws.sentMessages.length;

      proxy.handle.poll('printer.info', undefined, 500);
      await flushMicrotasks();
      respondLast(ws, { state: 'startup', state_message: 'new' });
      await flushMicrotasks();

      const p2 = proxy.handle.request('printer.info');
      await expect(p2).resolves.toEqual({ state: 'startup', state_message: 'new' });
      // request обслужен из snapshot, обновлённого поллом — нового send нет
      expect(ws.sentMessages.length).toBe(sentAfterP1 + 1);
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });

  it('MP-POLL-06: pollTick refreshes TTL cache for non-snapshot methods', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const p1 = proxy.handle.request('server.files.list');
      respondLast(ws, { files: ['old'] });
      await expect(p1).resolves.toEqual({ files: ['old'] });

      const sentAfterP1 = ws.sentMessages.length;

      proxy.handle.poll('server.files.list', undefined, 500);
      await flushMicrotasks();
      respondLast(ws, { files: ['new'] });
      await flushMicrotasks();

      const p2 = proxy.handle.request('server.files.list');
      await expect(p2).resolves.toEqual({ files: ['new'] });
      expect(ws.sentMessages.length).toBe(sentAfterP1 + 1);
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });

  it('MP-POLL-07: reconnect triggers immediate pollTick', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
      baseReconnectDelay: 1000,
      maxReconnectDelay: 5000,
    });

    try {
      const ws0 = await waitForSocket(instances, 0);
      ws0.simulateOpen();

      proxy.handle.poll('printer.info', undefined, 5000);
      await flushMicrotasks();
      respondLast(ws0, { state: 'ready' });

      ws0.simulateClose();
      vi.advanceTimersByTime(1000);

      const ws1 = await waitForSocket(instances, 1);
      const sentBeforeReopen = ws1.sentMessagesExcept('printer.objects.list').length;
      ws1.simulateOpen();
      await flushMicrotasks();

      // после open — немедленный тик всех активных поллов
      // (baseline printer.objects.list прокси отправляет сам, его не считаем)
      expect(ws1.sentMessagesExcept('printer.objects.list').length).toBe(sentBeforeReopen + 1);
      expect(ws1.lastSentMessage()?.method).toBe('printer.info');
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });

  it('MP-POLL-08: dispose clears all poll timers', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      proxy.handle.poll('printer.info', undefined, 500);
      proxy.handle.poll('server.info', undefined, 500);
      await flushMicrotasks();
      respondLast(ws, {});
      respondLast(ws, {});
      await flushMicrotasks();

      const sentAtDispose = ws.sentMessages.length;
      proxy.dispose();

      vi.advanceTimersByTime(5000);
      await flushMicrotasks();

      expect(ws.sentMessages.length).toBe(sentAtDispose);
    } finally {
      vi.useRealTimers();
    }
  });

  it('MP-POLL-09: pollTick errors do not break subsequent ticks', async () => {
    vi.useFakeTimers();
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      proxy.handle.poll('printer.info', undefined, 500);
      await flushMicrotasks();

      ws.respondError(ws.lastSentMessage()!.id as number, 'boom');
      await flushMicrotasks();

      const sentBefore = ws.sentMessages.length;

      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(ws.sentMessages.length).toBe(sentBefore + 1);
      respondLast(ws, { state: 'ready' });
      await flushMicrotasks();

      const p = proxy.handle.request('printer.info');
      await expect(p).resolves.toEqual({ state: 'ready' });
      expect(ws.sentMessages.length).toBe(sentBefore + 1);
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });
});