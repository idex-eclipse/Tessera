import { describe, expect, it } from 'vitest';

import { MemoryStorage } from '../storage';
import {
  createSettingsMirror,
  decodeRemoteKey,
  encodeRemoteKey,
  localKeyFor,
  pickHomePrinter,
  routeKey,
  type RemoteEnvelope,
} from '../settings-remote';

/** A tiny in-memory Moonraker: one namespace store per printer base URL. */
function fakeMoonraker() {
  const dbs = new Map<string, Record<string, unknown>>();
  const down = new Set<string>();
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const base = url.origin;
    if (down.has(base)) throw new TypeError('network');
    const db = dbs.get(base) ?? {};
    dbs.set(base, db);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { namespace: string; key: string; value: unknown };
      db[body.key] = body.value;
      return new Response(JSON.stringify({ result: {} }), { status: 200 });
    }
    const key = url.searchParams.get('key');
    if (key === null) {
      return new Response(JSON.stringify({ result: { namespace: 'tessera', value: db } }), { status: 200 });
    }
    if (!(key in db)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ result: { value: db[key] } }), { status: 200 });
  };
  return { dbs, down, fetch: impl as typeof fetch };
}

const PRINTERS = [{ id: 'p1', name: 'A', url: 'http://printer-a:7125' }];
const DB = 'http://printer-a:7125';

/** One simulated browser: its own localStorage, the shared fake Moonraker. */
function setup(fm = fakeMoonraker(), storage = new MemoryStorage()) {
  storage.setItem('mpu:v2:printers', JSON.stringify(PRINTERS));
  const mirror = createSettingsMirror({
    storage,
    fetch: fm.fetch,
    origin: DB,
    pushDelayMs: 1,
  });
  return { fm, storage, mirror };
}

describe('settings-remote / key routing', () => {
  it('escapes dots so Moonraker does not read them as a path', () => {
    expect(decodeRemoteKey(encodeRemoteKey('plugin-settings:tessera/a.b'))).toBe('plugin-settings:tessera/a.b');
    expect(encodeRemoteKey('a.b')).not.toContain('.');
  });

  it('routes per-printer keys to that printer without the local id in the remote key', () => {
    expect(routeKey('mpu:v2:settings:p1', 'p1')).toEqual({ printerId: 'p1', remoteKey: 'settings' });
    expect(routeKey('mpu:v2:plugin-settings:p2:tessera/x', 'p1')).toEqual({
      printerId: 'p2',
      remoteKey: 'plugin-settings:tessera/x',
    });
    expect(localKeyFor('plugin-settings:tessera/x', 'p2', 'p1')).toBe('mpu:v2:plugin-settings:p2:tessera/x');
  });

  it('routes global keys to the home printer and never mirrors device-only keys', () => {
    expect(routeKey('mpu:v2:ui', 'p1')).toEqual({ printerId: 'p1', remoteKey: 'ui' });
    expect(routeKey('mpu:v2:plugin-settings:GLOBAL:tessera/x', 'p1')?.printerId).toBe('p1');
    for (const k of [
      'mpu:v2:printers',
      'mpu:v2:activePrinter',
      'mpu:v2:auth:p1',
      'mpu:v2:deviceId',
      'mpu:v2:settingsSync',
    ]) {
      expect(routeKey(k, 'p1')).toBeNull();
    }
    // A global record found in a non-home DB is ignored
    expect(localKeyFor('ui', 'p2', 'p1')).toBeNull();
  });

  it('home printer is the one on the page origin, else the first', () => {
    const list = [
      { id: 'a', url: 'http://x:7125' },
      { id: 'b', url: 'http://y/' },
    ];
    expect(pickHomePrinter(list, 'http://y')).toBe('b');
    expect(pickHomePrinter(list, 'http://zzz')).toBe('a');
    expect(pickHomePrinter([], 'http://zzz')).toBeNull();
  });
});

describe('settings-remote / mirror', () => {
  it('migrates existing local settings into an empty DB with app, rev and writer', async () => {
    const { fm, storage, mirror } = setup();
    storage.setItem('mpu:v2:settings:p1', JSON.stringify({ pages: { jobs: false } }));
    await mirror.pull();
    await mirror.flush();

    const rec = fm.dbs.get(DB)?.settings as RemoteEnvelope;
    expect(rec.app).toBe('tessera');
    expect(rec.kind).toBe('settings');
    expect(rec.rev).toBe(1);
    expect(rec.data).toEqual({ pages: { jobs: false } });
    expect(rec.writer.deviceId).toBe(storage.getItem('mpu:v2:deviceId'));
  });

  it('a write through the wrapper reaches the DB with an increasing revision', async () => {
    const { fm, mirror } = setup();
    await mirror.pull();
    mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 1 }));
    await mirror.flush();
    mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 2 }));
    await mirror.flush();
    const rec = fm.dbs.get(DB)?.settings as RemoteEnvelope;
    expect(rec.rev).toBe(2);
    expect(rec.data).toEqual({ n: 2 });
  });

  it('a second browser receives the newer copy', async () => {
    const fm = fakeMoonraker();
    const a = setup(fm);
    await a.mirror.pull();
    a.mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 1 }));
    await a.mirror.flush();

    const b = setup(fm);
    const res = await b.mirror.pull();
    expect(res.changed).toBe(true);
    expect(JSON.parse(b.storage.getItem('mpu:v2:settings:p1')!)).toEqual({ n: 1 });
  });

  it('last write wins by revision: a stale browser publishes above the remote revision', async () => {
    const fm = fakeMoonraker();
    const a = setup(fm);
    const b = setup(fm);
    await a.mirror.pull();
    await b.mirror.pull();

    a.mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ from: 'a' }));
    await a.mirror.flush();
    // b never saw a's write, edits the same key and pushes later
    b.mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ from: 'b' }));
    await b.mirror.flush();

    const rec = fm.dbs.get(DB)?.settings as RemoteEnvelope;
    expect(rec.data).toEqual({ from: 'b' });
    expect(rec.rev).toBe(2);
    // a picks it up on the next pull
    await a.mirror.pull();
    expect(JSON.parse(a.storage.getItem('mpu:v2:settings:p1')!)).toEqual({ from: 'b' });
  });

  it('a pending local edit is not overwritten by an older remote copy', async () => {
    const fm = fakeMoonraker();
    const a = setup(fm);
    await a.mirror.pull();
    a.mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 1 }));
    await a.mirror.flush();

    const b = setup(fm);
    await b.mirror.pull();
    b.mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 'local' }));
    await b.mirror.pull(); // before the push
    expect(JSON.parse(b.storage.getItem('mpu:v2:settings:p1')!)).toEqual({ n: 'local' });
  });

  it('works offline: local writes stay, the push happens when Moonraker is back', async () => {
    const fm = fakeMoonraker();
    const { mirror, storage } = setup(fm);
    fm.down.add(DB);
    expect((await mirror.pull()).changed).toBe(false);
    mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 1 }));
    await mirror.flush();
    expect(storage.getItem('mpu:v2:settings:p1')).not.toBeNull();
    expect(mirror.hasPending()).toBe(true);

    fm.down.clear();
    await mirror.flush();
    expect(fm.dbs.get(DB)?.settings).toBeDefined();
  });

  it('keeps the background image and device-only keys out of the DB', async () => {
    const { fm, storage, mirror } = setup();
    storage.setItem('mpu:v2:ui', JSON.stringify({ theme: 'dark', bgImage: 'data:image/png;base64,AAAA' }));
    storage.setItem('mpu:v2:auth:p1', JSON.stringify({ token: 'secret-token' }));
    await mirror.pull();
    await mirror.flush();

    const db = fm.dbs.get(DB) ?? {};
    expect((db.ui as RemoteEnvelope).data).toEqual({ theme: 'dark' });
    expect(JSON.stringify(db)).not.toContain('secret-token');
    expect(Object.keys(db).some((k) => k.includes('auth') || k.includes('printers'))).toBe(false);
  });

  it('a pulled ui record keeps the background image of this device', async () => {
    const fm = fakeMoonraker();
    const a = setup(fm);
    a.storage.setItem('mpu:v2:ui', JSON.stringify({ theme: 'dark' }));
    await a.mirror.pull();
    await a.mirror.flush();

    const b = setup(fm);
    b.storage.setItem('mpu:v2:ui', JSON.stringify({ theme: 'light', bgImage: 'data:image/png;base64,BBBB' }));
    await b.mirror.pull();
    expect(JSON.parse(b.storage.getItem('mpu:v2:ui')!)).toEqual({
      theme: 'dark',
      bgImage: 'data:image/png;base64,BBBB',
    });
  });

  it('ignores DB records that are not Tessera settings', async () => {
    const { fm, storage, mirror } = setup();
    fm.dbs.set(DB, { settings: { foo: 1 } });
    await mirror.pull();
    expect(storage.getItem('mpu:v2:settings:p1')).toBeNull();
  });
});
