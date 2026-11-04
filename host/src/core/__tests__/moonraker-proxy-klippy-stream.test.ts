import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKlippyStream, toKlippySocketUrl } from '../klippy-stream';
import { clearMoonrakerProxyPool, createMoonrakerProxy, type WebSocketFactory } from '../moonraker-proxy';
import { MockWebSocket } from './mock-websocket';

function createWsFactory(): { instances: MockWebSocket[]; factory: WebSocketFactory } {
  const instances: MockWebSocket[] = [];
  const factory: WebSocketFactory = (url) => {
    const ws = new MockWebSocket(url);
    instances.push(ws);
    return ws;
  };
  return { instances, factory };
}

function create() {
  const { instances, factory } = createWsFactory();
  const stream = createKlippyStream({
    url: () => toKlippySocketUrl('ws://printer.local/websocket'),
    webSocketFactory: factory,
    baseReconnectDelay: 1000,
    maxReconnectDelay: 4000,
  });
  return { instances, stream };
}

const FORCE = 'load_cell/dump_force';

function templateKey(ws: MockWebSocket, index = 0): string {
  return (ws.sentMessages[index]!.params as { response_template: { key: string } }).response_template.key;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearMoonrakerProxyPool();
});

describe('toKlippySocketUrl', () => {
  it('replaces the websocket path and keeps the prefix', () => {
    expect(toKlippySocketUrl('ws://h:7125/websocket')).toBe('ws://h:7125/klippysocket');
    expect(toKlippySocketUrl('wss://h/p/websocket')).toBe('wss://h/p/klippysocket');
    expect(toKlippySocketUrl('ws://h/custom')).toBe('ws://h/custom/klippysocket');
  });
});

describe('klippy stream', () => {
  it('opens the socket lazily, with the first subscription only', () => {
    const { instances, stream } = create();
    expect(instances).toHaveLength(0);

    stream.subscribe(FORCE, { sensor: 'lc' }, () => {});
    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe('ws://printer.local/klippysocket');
  });

  it('subscribes with a response_template key and routes the batches', () => {
    const { instances, stream } = create();
    const onData = vi.fn();
    const onStatus = vi.fn();
    stream.subscribe(FORCE, { sensor: 'lc' }, onData, onStatus);
    expect(onStatus).toHaveBeenLastCalledWith('connecting');

    const ws = instances[0]!;
    ws.simulateOpen();
    expect(onStatus).toHaveBeenLastCalledWith('live');

    const req = ws.sentMessages[0]!;
    expect(req.method).toBe(FORCE);
    expect(req.jsonrpc).toBeUndefined();
    expect((req.params as { sensor: string }).sensor).toBe('lc');

    ws.simulateMessage({ id: req.id, result: {} });
    const batch = { data: [[1, 2.5, 100, 90]] };
    ws.simulateMessage({ key: templateKey(ws), params: batch });
    ws.simulateMessage({ key: 'other', params: {} });
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith(batch);
  });

  it('shares one Klipper stream between equal subscriptions', () => {
    const { instances, stream } = create();
    const a = vi.fn();
    const b = vi.fn();
    stream.subscribe(FORCE, { sensor: 'lc' }, a);
    instances[0]!.simulateOpen();
    stream.subscribe(FORCE, { sensor: 'lc' }, b);

    expect(instances[0]!.sent).toHaveLength(1);
    instances[0]!.simulateMessage({ key: templateKey(instances[0]!), params: { data: [] } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('closes the socket with the last unsubscribe and does not reopen', () => {
    const { instances, stream } = create();
    const off1 = stream.subscribe(FORCE, { sensor: 'lc' }, () => {});
    const off2 = stream.subscribe(FORCE, { sensor: 'lc' }, () => {});
    instances[0]!.simulateOpen();

    off1();
    expect(instances[0]!.readyState).toBe(1);
    off2();
    expect(instances[0]!.readyState).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(instances).toHaveLength(1);
  });

  it('recycles the socket when one of two streams stops (Klipper has no unsubscribe)', () => {
    const { instances, stream } = create();
    const offA = stream.subscribe(FORCE, { sensor: 'a' }, () => {});
    stream.subscribe(FORCE, { sensor: 'b' }, () => {});
    instances[0]!.simulateOpen();
    expect(instances[0]!.sent).toHaveLength(2);

    offA();
    expect(instances[0]!.readyState).toBe(3);
    expect(instances).toHaveLength(2);
    instances[1]!.simulateOpen();
    const sent = instances[1]!.sentMessages;
    expect(sent).toHaveLength(1);
    expect((sent[0]!.params as { sensor: string }).sensor).toBe('b');
  });

  it('reports unavailable, reconnects with backoff and resubscribes', () => {
    const { instances, stream } = create();
    const onStatus = vi.fn();
    stream.subscribe(FORCE, { sensor: 'lc' }, () => {}, onStatus);
    instances[0]!.simulateClose();
    expect(onStatus).toHaveBeenLastCalledWith('unavailable');

    vi.advanceTimersByTime(999);
    expect(instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(2);

    instances[1]!.simulateClose();
    vi.advanceTimersByTime(1999);
    expect(instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(3);

    instances[2]!.simulateOpen();
    expect(onStatus).toHaveBeenLastCalledWith('live');
    expect(instances[2]!.sent).toHaveLength(1);
  });

  it('marks only the rejected subscription as unavailable', () => {
    const { instances, stream } = create();
    const bad = vi.fn();
    const good = vi.fn();
    stream.subscribe(FORCE, { sensor: 'nope' }, () => {}, bad);
    stream.subscribe(FORCE, { sensor: 'lc' }, () => {}, good);
    const ws = instances[0]!;
    ws.simulateOpen();
    ws.simulateMessage({ id: ws.sentMessages[0]!.id, error: { message: 'Unknown load_cell' } });

    expect(bad).toHaveBeenLastCalledWith('unavailable');
    expect(good).toHaveBeenLastCalledWith('live');
    expect(ws.readyState).toBe(1);
  });

  it('allows the load cell probe tap stream', () => {
    const { instances, stream } = create();
    const onData = vi.fn();
    stream.subscribe('load_cell_probe/dump_taps', { sensor: 'lcp' }, onData);
    expect(instances).toHaveLength(1);

    const ws = instances[0]!;
    ws.simulateOpen();
    const req = ws.sentMessages[0]!;
    expect(req.method).toBe('load_cell_probe/dump_taps');

    const tap = { tap: { time: [1, 2], force: [3, 4] } };
    ws.simulateMessage({ key: templateKey(ws), params: tap });
    expect(onData).toHaveBeenCalledWith(tap);
  });

  it('refuses methods outside the allowlist', () => {
    const { instances, stream } = create();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const off = stream.subscribe('gcode/subscribe_output', {}, () => {});
    expect(instances).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    expect(() => off()).not.toThrow();
  });

  it('dispose closes the socket and ignores further subscriptions', () => {
    const { instances, stream } = create();
    stream.subscribe(FORCE, { sensor: 'lc' }, () => {});
    stream.dispose();
    expect(instances[0]!.readyState).toBe(3);
    stream.subscribe(FORCE, { sensor: 'lc' }, () => {});
    vi.advanceTimersByTime(60_000);
    expect(instances).toHaveLength(1);
  });
});

describe('proxy handle klippyStream', () => {
  it('uses /klippysocket of the printer origin with the auth token, closes on dispose', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const { instances, factory } = createWsFactory();
    const proxy = createMoonrakerProxy('http://printer.local:7125', { WebSocket: factory, baseReconnectDelay: 10_000 });
    proxy.setAuthToken('abc');
    await vi.advanceTimersByTimeAsync(0);

    const before = instances.length;
    proxy.handle.klippyStream(FORCE, { sensor: 'lc' }, () => {});
    expect(instances).toHaveLength(before + 1);
    const bridge = instances[instances.length - 1]!;
    expect(bridge.url).toBe('ws://printer.local:7125/klippysocket?token=abc');

    proxy.dispose();
    expect(bridge.readyState).toBe(3);
  });
});
