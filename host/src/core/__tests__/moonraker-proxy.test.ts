import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockWebSocket } from './mock-websocket';

import {
  clearMoonrakerProxyPool,
  createMoonrakerProxy,
  getMoonrakerProxy,
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
}

/** probeAuthStatus ходит в HTTP fetch ДО создания сокета — в тестах стабим. */
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

/** connect() создаёт сокет после async-пробы auth — ждём его появления. */
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

beforeEach(() => {
  stubAuthProbeOk();
});

afterEach(() => {
  clearMoonrakerProxyPool();
  MockWebSocket.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MoonrakerProxy / pool', () => {
  it('MP-POOL-01: one proxy per normalized URL', async () => {
    const { factory, instances } = createWsFactory();

    const a1 = getMoonrakerProxy('http://printer.local', { WebSocket: factory });
    const a2 = getMoonrakerProxy('http://printer.local', { WebSocket: factory });

    await waitForSocket(instances);

    expect(a1).toBe(a2);
    expect(instances).toHaveLength(1);
  });

  it('MP-POOL-02: different URLs create different proxies', async () => {
    const { factory, instances } = createWsFactory();

    const a = getMoonrakerProxy('http://printer-a.local', { WebSocket: factory });
    const b = getMoonrakerProxy('http://printer-b.local', { WebSocket: factory });

    await waitForSocket(instances, 1);

    expect(a).not.toBe(b);
    expect(instances).toHaveLength(2);
  });

  it('MP-POOL-04: trailing slash is normalized', async () => {
    const { factory, instances } = createWsFactory();

    const a1 = getMoonrakerProxy('http://printer.local/', { WebSocket: factory });
    const a2 = getMoonrakerProxy('http://printer.local', { WebSocket: factory });

    await waitForSocket(instances);

    expect(a1).toBe(a2);
    expect(instances).toHaveLength(1);
  });

  it('MP-POOL-05: dispose is idempotent and removes proxy from pool', async () => {
    const { factory, instances } = createWsFactory();

    const p1 = getMoonrakerProxy('http://printer.local', { WebSocket: factory });
    await waitForSocket(instances);
    p1.dispose();

    expect(() => p1.dispose()).not.toThrow();

    const p2 = getMoonrakerProxy('http://printer.local', { WebSocket: factory });
    await waitForSocket(instances, 1);

    expect(p2).not.toBe(p1);
    expect(instances).toHaveLength(2);
  });
});

describe('MoonrakerProxy / connection', () => {
  it('MP-CONN-01: initial readyState is connecting', () => {
    const { factory } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      expect(proxy.handle.readyState).toBe('connecting');
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CONN-02: open transitions to open and fires onReady', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      const statuses: string[] = [];
      let readyCount = 0;

      proxy.handle.onConnectionStatusChange((status) => {
        statuses.push(status);
      });

      proxy.handle.onReady(() => {
        readyCount += 1;
      });

      (await waitForSocket(instances)).simulateOpen();

      expect(proxy.handle.readyState).toBe('open');
      expect(statuses).toEqual(['open']);
      expect(readyCount).toBe(1);
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CONN-03: unexpected close transitions to closed', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
      baseReconnectDelay: 10_000,
    });

    try {
      const statuses: string[] = [];

      (await waitForSocket(instances)).simulateOpen();

      proxy.handle.onConnectionStatusChange((status) => {
        statuses.push(status);
      });

      last(instances).simulateClose();

      expect(proxy.handle.readyState).toBe('closed');
      expect(statuses).toEqual(['closed']);
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CONN-05: onReady fires after reconnect too', async () => {
    vi.useFakeTimers();

    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
      baseReconnectDelay: 1000,
      maxReconnectDelay: 5000,
    });

    try {
      let readyCount = 0;

      proxy.handle.onReady(() => {
        readyCount += 1;
      });

      const ws0 = await waitForSocket(instances, 0);
      ws0.simulateOpen();
      expect(readyCount).toBe(1);

      ws0.simulateClose();
      vi.advanceTimersByTime(1000);

      const ws1 = await waitForSocket(instances, 1);
      ws1.simulateOpen();

      expect(readyCount).toBe(2);
    } finally {
      proxy.dispose();
      vi.useRealTimers();
    }
  });

  it('MP-CONN-06: onReady called asynchronously if already open', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      let called = 0;

      (await waitForSocket(instances)).simulateOpen();

      proxy.handle.onReady(() => {
        called += 1;
      });

      expect(called).toBe(0);

      await flushMicrotasks();

      expect(called).toBe(1);
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CONN-08: offline/close during startup does not throw', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
      baseReconnectDelay: 10_000,
    });

    try {
      const ws = await waitForSocket(instances);
      expect(() => ws.simulateClose()).not.toThrow();
      expect(proxy.handle.readyState).toBe('closed');
    } finally {
      proxy.dispose();
    }
  });
});

describe('MoonrakerProxy / request', () => {
  it('MP-REQ-01: request sends valid JSON-RPC message', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      const ws = await waitForSocket(instances);
      ws.simulateOpen();

      const promise = proxy.handle.request('server.info');
      const message = ws.lastSentMessage();

      expect(message).toMatchObject({
        jsonrpc: '2.0',
        method: 'server.info',
      });

      expect(typeof message?.id).toBe('number');

      ws.respond(message!.id as number, { ok: true });

      await expect(promise).resolves.toEqual({ ok: true });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-REQ-03: request rejects on JSON-RPC error', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      const ws = await waitForSocket(instances);
      ws.simulateOpen();

      const promise = proxy.handle.request('server.info');
      const message = ws.lastSentMessage();

      ws.respondError(message!.id as number, 'boom');

      await expect(promise).rejects.toThrow('boom');
    } finally {
      proxy.dispose();
    }
  });

  it('MP-REQ-04: unknown response id is ignored', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      const ws = await waitForSocket(instances);
      ws.simulateOpen();

      const promise = proxy.handle.request('server.info');
      const message = ws.lastSentMessage();

      ws.simulateMessage({
        jsonrpc: '2.0',
        id: 999,
        result: { wrong: true },
      });

      ws.respond(message!.id as number, { right: true });

      await expect(promise).resolves.toEqual({ right: true });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-REQ-05: parallel requests resolve independently', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      const ws = await waitForSocket(instances);
      ws.simulateOpen();

      const p1 = proxy.handle.request('method.one');
      const p2 = proxy.handle.request('method.two');

      const messages = ws.sentMessages;

      const id1 = messages[0]!.id as number;
      const id2 = messages[1]!.id as number;

      ws.respond(id2, 'two');
      ws.respond(id1, 'one');

      await expect(p1).resolves.toBe('one');
      await expect(p2).resolves.toBe('two');
    } finally {
      proxy.dispose();
    }
  });

  it('MP-REQ-06: request while closed rejects', async () => {
    const { factory } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      await expect(proxy.handle.request('server.info')).rejects.toThrow(
        'Moonraker connection is not open',
      );
    } finally {
      proxy.dispose();
    }
  });

  it('MP-REQ-08: malformed messages do not break proxy', async () => {
    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      const ws = await waitForSocket(instances);
      ws.simulateOpen();

      expect(() => ws.simulateMessage('{broken')).not.toThrow();
      expect(() => ws.simulateMessage(null)).not.toThrow();
      expect(() => ws.simulateMessage(42)).not.toThrow();

      expect(proxy.handle.readyState).toBe('open');
    } finally {
      proxy.dispose();
    }
  });
});

describe('MoonrakerProxy / httpBaseUrl', () => {
  it('MP-HTTP-01: http URL maps to same origin', () => {
    const { factory } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
    });

    try {
      expect(proxy.httpBaseUrl).toBe('http://printer.local');
      expect(proxy.handle.httpBaseUrl).toBe('http://printer.local');
    } finally {
      proxy.dispose();
    }
  });

  it('MP-HTTP-02: ws URL maps to http origin', () => {
    const { factory } = createWsFactory();

    const proxy = createMoonrakerProxy('ws://printer.local/websocket', {
      WebSocket: factory,
    });

    try {
      expect(proxy.httpBaseUrl).toBe('http://printer.local');
    } finally {
      proxy.dispose();
    }
  });

  it('MP-HTTP-03: wss URL maps to https origin', () => {
    const { factory } = createWsFactory();

    const proxy = createMoonrakerProxy('wss://printer.local/websocket', {
      WebSocket: factory,
    });

    try {
      expect(proxy.httpBaseUrl).toBe('https://printer.local');
    } finally {
      proxy.dispose();
    }
  });
});

describe('MoonrakerProxy / lifecycle', () => {
  it('MP-LIFE-03: dispose stops reconnect attempts', async () => {
    vi.useFakeTimers();

    const { factory, instances } = createWsFactory();

    const proxy = createMoonrakerProxy('http://printer.local', {
      WebSocket: factory,
      baseReconnectDelay: 1000,
    });

    const ws0 = await waitForSocket(instances, 0);
    ws0.simulateOpen();
    ws0.simulateClose();

    proxy.dispose();

    vi.advanceTimersByTime(10_000);
    await flushMicrotasks();

    expect(instances).toHaveLength(1);

    vi.useRealTimers();
  });
});