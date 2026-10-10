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

async function openProxyWithClock(
  instances: MockWebSocket[],
  factory: WebSocketFactory,
  now: () => number,
): Promise<MoonrakerProxy> {
  const proxy = createMoonrakerProxy('http://printer.local', {
    WebSocket: factory,
    baseReconnectDelay: 10_000,
    now,
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
  vi.unstubAllGlobals();
});

describe('MoonrakerProxy / TTL cache', () => {
  it('MP-CACHE-01 + MP-CACHE-02: caches within TTL and expires after TTL', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.files.list');
      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { files: [] });

      await expect(first).resolves.toEqual({ files: [] });

      const sentCount = ws.sentMessages.length;

      const second = proxy.handle.request('server.files.list');

      await expect(second).resolves.toEqual({ files: [] });
      expect(ws.sentMessages.length).toBe(sentCount);

      now += 10_001;

      const third = proxy.handle.request('server.files.list');
      const thirdMessage = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(sentCount + 1);

      ws.respond(thirdMessage!.id as number, { files: ['new'] });

      await expect(third).resolves.toEqual({ files: ['new'] });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-03: different params create different cache entries', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const a = proxy.handle.request('server.files.list', { path: 'a' });
      const messageA = ws.lastSentMessage();

      ws.respond(messageA!.id as number, { files: ['a'] });

      await expect(a).resolves.toEqual({ files: ['a'] });

      const sentCount = ws.sentMessages.length;

      const b = proxy.handle.request('server.files.list', { path: 'b' });
      const messageB = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(sentCount + 1);

      ws.respond(messageB!.id as number, { files: ['b'] });

      await expect(b).resolves.toEqual({ files: ['b'] });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-04: object key order does not affect cache key', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.files.list', {
        a: 1,
        b: 2,
      });

      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { files: [] });

      await expect(first).resolves.toEqual({ files: [] });

      const sentCount = ws.sentMessages.length;

      const second = proxy.handle.request('server.files.list', {
        b: 2,
        a: 1,
      });

      await expect(second).resolves.toEqual({ files: [] });
      expect(ws.sentMessages.length).toBe(sentCount);
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-05: notify_filelist_changed invalidates file cache', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.files.list');
      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { files: [] });

      await expect(first).resolves.toEqual({ files: [] });

      const sentCount = ws.sentMessages.length;

      ws.notify('notify_filelist_changed', {});

      const second = proxy.handle.request('server.files.list');
      const secondMessage = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(sentCount + 1);

      ws.respond(secondMessage!.id as number, { files: ['updated'] });

      await expect(second).resolves.toEqual({ files: ['updated'] });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-05b: unrelated notify does not invalidate file cache', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.files.list');
      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { files: [] });

      await expect(first).resolves.toEqual({ files: [] });

      const sentCount = ws.sentMessages.length;

      ws.notify('notify_history_changed', {});

      const second = proxy.handle.request('server.files.list');

      await expect(second).resolves.toEqual({ files: [] });
      expect(ws.sentMessages.length).toBe(sentCount);
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-06: notify_history_changed invalidates history cache', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.history.list');
      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { history: [] });

      await expect(first).resolves.toEqual({ history: [] });

      const sentCount = ws.sentMessages.length;

      ws.notify('notify_history_changed', {});

      const second = proxy.handle.request('server.history.list');
      const secondMessage = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(sentCount + 1);

      ws.respond(secondMessage!.id as number, { history: ['job'] });

      await expect(second).resolves.toEqual({ history: ['job'] });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-06b: config cache is invalidated by notify_config_changed', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('printer.configfile.get_config');
      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { config: {} });

      await expect(first).resolves.toEqual({ config: {} });

      const sentCount = ws.sentMessages.length;

      ws.notify('notify_config_changed', {});

      const second = proxy.handle.request('printer.configfile.get_config');
      const secondMessage = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(sentCount + 1);

      ws.respond(secondMessage!.id as number, { config: { updated: true } });

      await expect(second).resolves.toEqual({ config: { updated: true } });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-07: error responses are not cached', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.files.list');
      const firstMessage = ws.lastSentMessage();

      ws.respondError(firstMessage!.id as number, 'boom');

      await expect(first).rejects.toThrow('boom');

      const sentCount = ws.sentMessages.length;

      const second = proxy.handle.request('server.files.list');
      const secondMessage = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(sentCount + 1);

      ws.respond(secondMessage!.id as number, { files: [] });

      await expect(second).resolves.toEqual({ files: [] });
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-08: side-effect methods are never cached', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('printer.gcode.script', {
        script: 'M117 first',
      });

      const firstMessage = ws.lastSentMessage();

      const second = proxy.handle.request('printer.gcode.script', {
        script: 'M117 first',
      });

      const secondMessage = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(2);
      expect(firstMessage!.id).not.toBe(secondMessage!.id);

      ws.respond(firstMessage!.id as number, {});
      ws.respond(secondMessage!.id as number, {});

      await expect(first).resolves.toEqual({});
      await expect(second).resolves.toEqual({});
    } finally {
      proxy.dispose();
    }
  });

  it('MP-CACHE-09: camera-related requests are not cached', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.webcams.list');
      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { webcams: [] });

      await expect(first).resolves.toEqual({ webcams: [] });

      const sentCount = ws.sentMessages.length;

      const second = proxy.handle.request('server.webcams.list');
      const secondMessage = ws.lastSentMessage();

      expect(ws.sentMessages.length).toBe(sentCount + 1);

      ws.respond(secondMessage!.id as number, { webcams: [] });

      await expect(second).resolves.toEqual({ webcams: [] });
    } finally {
      proxy.dispose();
    }
  });

  it('TTL cache can survive short connection loss, but expires by time', async () => {
    const { factory, instances } = createWsFactory();

    let now = 1_000;

    const proxy = await openProxyWithClock(instances, factory, () => now);
    const ws = last(instances);

    try {
      const first = proxy.handle.request('server.files.list');
      const firstMessage = ws.lastSentMessage();

      ws.respond(firstMessage!.id as number, { files: [] });

      await expect(first).resolves.toEqual({ files: [] });

      ws.simulateClose();

      const second = proxy.handle.request('server.files.list');

      await expect(second).resolves.toEqual({ files: [] });

      now += 10_001;

      await expect(proxy.handle.request('server.files.list')).rejects.toThrow(
        'Moonraker connection is not open',
      );
    } finally {
      proxy.dispose();
    }
  });
});

it('notify_klippy_* invalidates server.info snapshot', async () => {
  const { factory, instances } = createWsFactory();

  let now = 1_000;

  const proxy = await openProxyWithClock(instances, factory, () => now);
  const ws = last(instances);

  try {
    const first = proxy.handle.request('server.info');
    const firstMessage = ws.lastSentMessage();

    ws.respond(firstMessage!.id as number, { klippy_state: 'ready' });

    await expect(first).resolves.toEqual({ klippy_state: 'ready' });

    const sentCount = ws.sentMessages.length;

    ws.notify('notify_klippy_shutdown', []);

    const second = proxy.handle.request('server.info');
    const secondMessage = ws.lastSentMessage();

    expect(ws.sentMessages.length).toBe(sentCount + 1);

    ws.respond(secondMessage!.id as number, { klippy_state: 'shutdown' });

    await expect(second).resolves.toEqual({ klippy_state: 'shutdown' });
  } finally {
    proxy.dispose();
  }
});