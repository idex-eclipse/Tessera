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

  it('refuses blocked methods and their spelling variants, sending nothing', () => {
    const { instances, stream } = create();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocked = [
      'emergency_stop',
      'Emergency_Stop',
      ' emergency_stop ',
      'emergency_stop\u0003',
      'emergency\u0003_stop',
      '/emergency_stop',
      'ｅmergency_stop', // fullwidth "e": NFKC folds it into the blocked name
      'gcode/script',
      'GCODE/Script',
      'gcode/restart',
      'gcode/firmware_restart',
      'pause_resume/pause',
      'pause_resume/cancel',
      'register_remote_method',
    ];
    for (const method of blocked) {
      const off = stream.subscribe(method, {}, () => {});
      expect(() => off()).not.toThrow();
    }
    expect(instances).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(blocked.length);
  });

  it('refuses malformed method names and params', () => {
    const { instances, stream } = create();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stream.subscribe('', {}, () => {});
    stream.subscribe('a/b/c', {}, () => {});
    stream.subscribe('objects list', {}, () => {});
    stream.subscribe('objects/list', [] as unknown as Record<string, unknown>, () => {});
    stream.subscribe('objects/subscribe', { response_template: { q: 'x' } }, () => {});
    expect(instances).toHaveLength(0);
  });

  it('allows read endpoints beyond the former allowlist', () => {
    const { instances, stream } = create();
    for (const method of ['info', 'objects/list', 'motion_report/dump_trapq', 'tmc/stallguard_dump']) {
      stream.subscribe(method, { name: 'x' }, () => {});
    }
    expect(instances).toHaveLength(1);
    instances[0]!.simulateOpen();
    expect(instances[0]!.sentMessages.map((m) => m.method)).toEqual([
      'info',
      'objects/list',
      'motion_report/dump_trapq',
      'tmc/stallguard_dump',
    ]);
  });

  it('sends the normalized method name, not the original spelling', () => {
    const { instances, stream } = create();
    stream.subscribe('  Motion_Report/Dump_Trapq ', { name: 'toolhead' }, () => {});
    instances[0]!.simulateOpen();
    expect(instances[0]!.sentMessages[0]!.method).toBe('motion_report/dump_trapq');
  });

  it('shares one stream between params that differ only in key order', () => {
    const { instances, stream } = create();
    const a = vi.fn();
    const b = vi.fn();
    stream.subscribe('objects/subscribe', { objects: { toolhead: null, configfile: null }, x: 1 }, a);
    instances[0]!.simulateOpen();
    stream.subscribe('objects/subscribe', { x: 1, objects: { configfile: null, toolhead: null } }, b);
    expect(instances[0]!.sent).toHaveLength(1);
  });

  it('hands the subscribe ack to onAck, also to a late joiner, and again after a reconnect', () => {
    const { instances, stream } = create();
    const early = vi.fn();
    const late = vi.fn();
    stream.subscribe('objects/subscribe', { objects: { toolhead: null } }, () => {}, undefined, early);
    const ws = instances[0]!;
    ws.simulateOpen();
    const result = { eventtime: 5, status: { toolhead: { estimated_print_time: 1 } } };
    ws.simulateMessage({ id: ws.sentMessages[0]!.id, result });
    expect(early).toHaveBeenCalledWith(result);

    stream.subscribe('objects/subscribe', { objects: { toolhead: null } }, () => {}, undefined, late);
    expect(late).toHaveBeenCalledWith(result);

    ws.simulateClose();
    vi.advanceTimersByTime(1000);
    const ws2 = instances[1]!;
    ws2.simulateOpen();
    ws2.simulateMessage({ id: ws2.sentMessages[0]!.id, result: { eventtime: 9 } });
    expect(early).toHaveBeenLastCalledWith({ eventtime: 9 });
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

describe('klippy request', () => {
  it('sends the call once the socket is open and resolves with the result', async () => {
    const { instances, stream } = create();
    const promise = stream.request('objects/list');
    expect(instances).toHaveLength(1);
    const ws = instances[0]!;
    expect(ws.sent).toHaveLength(0);

    ws.simulateOpen();
    const req = ws.sentMessages[0]!;
    expect(req.method).toBe('objects/list');
    expect(req.jsonrpc).toBeUndefined();
    expect(req.params).toEqual({});
    ws.simulateMessage({ id: req.id, result: { objects: ['toolhead'] } });
    await expect(promise).resolves.toEqual({ objects: ['toolhead'] });
  });

  it('rejects with the Klipper error message', async () => {
    const { instances, stream } = create();
    const promise = stream.request('info');
    const ws = instances[0]!;
    ws.simulateOpen();
    ws.simulateMessage({ id: ws.sentMessages[0]!.id, error: { message: 'Klippy not ready' } });
    await expect(promise).rejects.toThrow('Klippy not ready');
  });

  it('rejects after the timeout and ignores a late answer', async () => {
    const { instances, stream } = create();
    const promise = stream.request('info', {}, { timeoutMs: 500 });
    const settled = promise.catch((e: Error): Error => e);
    const ws = instances[0]!;
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(500);
    expect(((await settled) as Error).message).toMatch(/timed out/);
    expect(() => ws.simulateMessage({ id: ws.sentMessages[0]!.id, result: {} })).not.toThrow();
  });

  it('rejects in-flight requests when the connection drops, without reconnecting', async () => {
    const { instances, stream } = create();
    const promise = stream.request('info');
    const settled = promise.catch((e: Error): Error => e);
    instances[0]!.simulateOpen();
    instances[0]!.simulateClose();
    expect(((await settled) as Error).message).toMatch(/lost/);
    vi.advanceTimersByTime(60_000);
    expect(instances).toHaveLength(1);
  });

  it('refuses blocked and malformed calls without opening a socket', async () => {
    const { instances, stream } = create();
    await expect(stream.request('emergency_stop')).rejects.toThrow(/blocked/);
    await expect(stream.request('Gcode/Script', { script: 'G28' })).rejects.toThrow(/blocked/);
    await expect(stream.request('pause_resume/pause')).rejects.toThrow(/blocked/);
    await expect(stream.request('objects/list', { response_template: { q: 1 } })).rejects.toThrow(/response_template/);
    await expect(stream.request('not a method')).rejects.toThrow(/malformed/);
    expect(instances).toHaveLength(0);
  });

  it('closes the idle socket after the last answer and leaves no dangling timers', async () => {
    const { instances, stream } = create();
    const promise = stream.request('info');
    const ws = instances[0]!;
    ws.simulateOpen();
    ws.simulateMessage({ id: ws.sentMessages[0]!.id, result: {} });
    await promise;
    expect(ws.readyState).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(ws.readyState).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reuses the socket for requests in a burst', async () => {
    const { instances, stream } = create();
    const first = stream.request('objects/list');
    const ws = instances[0]!;
    ws.simulateOpen();
    ws.simulateMessage({ id: ws.sentMessages[0]!.id, result: {} });
    await first;
    const second = stream.request('info');
    expect(instances).toHaveLength(1);
    ws.simulateMessage({ id: ws.sentMessages[1]!.id, result: { state: 'ready' } });
    await expect(second).resolves.toEqual({ state: 'ready' });
  });

  it('keeps the socket for a subscription that outlives the request', async () => {
    const { instances, stream } = create();
    stream.subscribe(FORCE, { sensor: 'lc' }, () => {});
    const promise = stream.request('info');
    const ws = instances[0]!;
    ws.simulateOpen();
    ws.simulateMessage({ id: ws.sentMessages[1]!.id, result: {} });
    await promise;
    vi.advanceTimersByTime(60_000);
    expect(ws.readyState).toBe(1);
    expect(instances).toHaveLength(1);
  });

  it('rejects pending requests on dispose and refuses new ones', async () => {
    const { instances, stream } = create();
    const settled = stream.request('info').catch((e: Error): Error => e);
    stream.dispose();
    expect(((await settled) as Error).message).toMatch(/disposed/);
    expect(instances[0]!.readyState).toBe(3);
    await expect(stream.request('info')).rejects.toThrow(/disposed/);
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
