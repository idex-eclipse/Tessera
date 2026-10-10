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

beforeEach(() => {
  stubAuthProbeOk();
});

afterEach(() => {
  clearMoonrakerProxyPool();
  MockWebSocket.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MoonrakerProxy / subscribe', () => {
  it('MP-SUB-01: first subscriber sends printer.objects.subscribe and receives initial status', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cb = vi.fn();

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb);

      const message = ws.lastSentMessage();

      expect(message?.method).toBe('printer.objects.subscribe');
      expect(message?.params).toEqual({
        objects: {
          extruder: ['temperature'],
        },
      });

      ws.respond(message!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      expect(cb).toHaveBeenCalledWith({
        extruder: {
          temperature: 25,
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-02: second identical subscriber gets snapshot without new subscribe', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb1);

      const message = ws.lastSentMessage();

      ws.respond(message!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      const sentCount = ws.sentMessages.length;

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb2);

      await flushMicrotasks();

      expect(ws.sentMessages.length).toBe(sentCount);
      expect(cb2).toHaveBeenCalledWith({
        extruder: {
          temperature: 25,
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-03: new fields trigger resubscribe with FULL union (replace semantics)', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb1);

      const first = ws.lastSentMessage();

      ws.respond(first!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      proxy.handle.subscribe(
        { extruder: ['temperature', 'target'] },
        cb2,
      );

      const second = ws.lastSentMessage();

      // Moonraker трактует каждый subscribe как ПОЛНЫЙ желаемый набор:
      // прокси шлёт дедуп-union всех подписчиков, а не дельту добавленных полей.
      expect(second?.method).toBe('printer.objects.subscribe');
      expect(second?.params).toEqual({
        objects: {
          extruder: ['temperature', 'target'],
        },
      });

      ws.respond(second!.id as number, {
        status: {
          extruder: {
            target: 60,
          },
        },
      });

      await flushMicrotasks();

      expect(cb2).toHaveBeenCalledWith({
        extruder: {
          temperature: 25,
          target: 60,
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-05 + MP-SUB-06: unsubscribe reduces fields, last unsubscribe removes object', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cbA = vi.fn();
      const cbB = vi.fn();

      const unsubA = proxy.handle.subscribe(
        { extruder: ['temperature'] },
        cbA,
      );

      const first = ws.lastSentMessage();

      ws.respond(first!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      const unsubB = proxy.handle.subscribe(
        { extruder: ['target'] },
        cbB,
      );

      const second = ws.lastSentMessage();

      ws.respond(second!.id as number, {
        status: {
          extruder: {
            target: 60,
          },
        },
      });

      await flushMicrotasks();

      unsubB();

      const unsubscribePartial = ws.lastSentMessage();

      expect(unsubscribePartial?.method).toBe('printer.objects.unsubscribe');
      expect(unsubscribePartial?.params).toEqual({
        objects: {
          extruder: ['target'],
        },
      });

      unsubA();

      const unsubscribeObject = ws.lastSentMessage();

      expect(unsubscribeObject?.method).toBe('printer.objects.unsubscribe');
      expect(unsubscribeObject?.params).toEqual({
        objects: {
          extruder: [],
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-07: unsubscribe is idempotent', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cb = vi.fn();

      const unsub = proxy.handle.subscribe(
        { extruder: ['temperature'] },
        cb,
      );

      const message = ws.lastSentMessage();

      ws.respond(message!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      unsub();

      expect(() => unsub()).not.toThrow();
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-08: subscriber receives only requested fields', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cbTemp = vi.fn();
      const cbTarget = vi.fn();

      proxy.handle.subscribe({ extruder: ['temperature'] }, cbTemp);

      const first = ws.lastSentMessage();

      ws.respond(first!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      proxy.handle.subscribe({ extruder: ['target'] }, cbTarget);

      const second = ws.lastSentMessage();

      ws.respond(second!.id as number, {
        status: {
          extruder: {
            target: 60,
          },
        },
      });

      await flushMicrotasks();

      cbTemp.mockClear();
      cbTarget.mockClear();

      ws.notify('notify_status_update', [
        {
          extruder: {
            temperature: 30,
            target: 70,
          },
        },
        123,
      ]);

      expect(cbTemp).toHaveBeenCalledWith({
        extruder: {
          temperature: 30,
        },
      });

      expect(cbTarget).toHaveBeenCalledWith({
        extruder: {
          target: 70,
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-10: immediate:false disables initial snapshot', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cb = vi.fn();

      proxy.handle.subscribe(
        { extruder: ['temperature'] },
        cb,
        { immediate: false },
      );

      const message = ws.lastSentMessage();

      ws.respond(message!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      expect(cb).not.toHaveBeenCalled();

      ws.notify('notify_status_update', [
        {
          extruder: {
            temperature: 26,
          },
        },
        123,
      ]);

      expect(cb).toHaveBeenCalledWith({
        extruder: {
          temperature: 26,
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-11: subscription before open is activated after open', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
      baseReconnectDelay: 10_000,
    });

    try {
      const ws = await waitForSocket(instances);

      const cb = vi.fn();

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb);

      expect(ws.sentMessages).toHaveLength(0);

      ws.simulateOpen();

      const message = ws.lastSentMessage();

      expect(message?.method).toBe('printer.objects.subscribe');

      ws.respond(message!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      expect(cb).toHaveBeenCalledWith({
        extruder: {
          temperature: 25,
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SUB-12: reconnect restores active subscriptions', async () => {
    vi.useFakeTimers();

    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
      baseReconnectDelay: 1000,
      maxReconnectDelay: 5000,
    });

    try {
      const cb = vi.fn();

      const ws0 = await waitForSocket(instances, 0);
      ws0.simulateOpen();

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb);

      const firstMessage = ws0.lastSentMessage();

      ws0.respond(firstMessage!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      expect(cb).toHaveBeenCalledWith({
        extruder: {
          temperature: 25,
        },
      });

      cb.mockClear();

      ws0.simulateClose();

      vi.advanceTimersByTime(1000);

      const ws1 = await waitForSocket(instances, 1);
      ws1.simulateOpen();

      const restoredMessage = ws1.lastSentMessage();

      expect(restoredMessage?.method).toBe('printer.objects.subscribe');
      expect(restoredMessage?.params).toEqual({
        objects: {
          extruder: ['temperature'],
        },
      });

      ws1.respond(restoredMessage!.id as number, {
        status: {
          extruder: {
            temperature: 40,
          },
        },
      });

      await flushMicrotasks();

      expect(cb).toHaveBeenCalledWith({
        extruder: {
          temperature: 40,
        },
      });
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });
});

describe('MoonrakerProxy / status snapshot', () => {
  it('MP-SNAP-02 + MP-SNAP-03: new subscriber receives updated snapshot immediately', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb1);

      const message = ws.lastSentMessage();

      ws.respond(message!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      ws.notify('notify_status_update', [
        {
          extruder: {
            temperature: 26,
          },
        },
        123,
      ]);

      const sentCount = ws.sentMessages.length;

      proxy.handle.subscribe({ extruder: ['temperature'] }, cb2);

      await flushMicrotasks();

      expect(ws.sentMessages.length).toBe(sentCount);
      expect(cb2).toHaveBeenCalledWith({
        extruder: {
          temperature: 26,
        },
      });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SNAP-04: server.info is cached while WS is alive', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const promise1 = proxy.handle.request('server.info');
      const message = ws.lastSentMessage();

      const sentCount = ws.sentMessages.length;

      ws.respond(message!.id as number, {
        version: '1',
      });

      await expect(promise1).resolves.toEqual({ version: '1' });

      const promise2 = proxy.handle.request('server.info');

      await expect(promise2).resolves.toEqual({ version: '1' });

      expect(ws.sentMessages.length).toBe(sentCount);
    } finally {
      proxy.dispose();
    }
  });

  it('MP-SNAP-06: server.info snapshot cache is cleared on close', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const promise = proxy.handle.request('server.info');
      const message = ws.lastSentMessage();

      ws.respond(message!.id as number, {
        version: '1',
      });

      await expect(promise).resolves.toEqual({ version: '1' });

      ws.simulateClose();

      await expect(proxy.handle.request('server.info')).rejects.toThrow(
        'Moonraker connection is not open',
      );
    } finally {
      proxy.dispose();
    }
  });
});

describe('MoonrakerProxy / notify_status_update robustness', () => {
  it('MP-STATUS-04: malformed status notifications are ignored', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      expect(() =>
        ws.notify('notify_status_update', null),
      ).not.toThrow();

      expect(() =>
        ws.notify('notify_status_update', [
          {
            extruder: null,
          },
          123,
        ]),
      ).not.toThrow();

      expect(proxy.handle.readyState).toBe('open');
    } finally {
      proxy.dispose();
    }
  });

  it('listener errors do not break other subscribers', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const bad = vi.fn(() => {
        throw new Error('bad listener');
      });

      const good = vi.fn();

      proxy.handle.subscribe({ extruder: ['temperature'] }, bad);

      const first = ws.lastSentMessage();

      ws.respond(first!.id as number, {
        status: {
          extruder: {
            temperature: 25,
          },
        },
      });

      await flushMicrotasks();

      proxy.handle.subscribe({ extruder: ['temperature'] }, good);

      await flushMicrotasks();

      bad.mockClear();
      good.mockClear();

      ws.notify('notify_status_update', [
        {
          extruder: {
            temperature: 30,
          },
        },
        123,
      ]);

      expect(good).toHaveBeenCalledWith({
        extruder: {
          temperature: 30,
        },
      });

      expect(errorSpy).toHaveBeenCalled();
    } finally {
      proxy.dispose();
      errorSpy.mockRestore();
    }
  });

  it('onNotify receives notify_status_update as generic event too', async () => {
    const { factory, instances } = createWsFactory();
    const proxy = await openProxy(instances, factory);
    const ws = last(instances);

    try {
      const notifyCb = vi.fn();

      proxy.handle.onNotify('notify_status_update', notifyCb);

      ws.notify('notify_status_update', [
        {
          extruder: {
            temperature: 30,
          },
        },
        123,
      ]);

      expect(notifyCb).toHaveBeenCalled();
    } finally {
      proxy.dispose();
    }
  });
});