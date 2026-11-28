import { describe, expect, it } from 'vitest';

import { MemoryStorage } from '../storage';
import {
  createSettingsMirror,
  decodeRemoteKey,
  encodeRemoteKey,
  localKeyFor,
  pickHomePrinter,
  REMOTE_SCHEMA,
  routeKey,
  type RemoteEnvelope,
  type RouteContext,
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
    if (init?.method === 'DELETE') {
      const delKey = url.searchParams.get('key');
      if (delKey !== null) delete db[delKey];
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
const CTX: RouteContext = { homePrinterId: 'p1', deviceId: 'dev-1' };

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

/** A record as the mirror writes it; `key` is filled by the test when it matters. */
function envelope(data: unknown, rev = 1, schema = REMOTE_SCHEMA): RemoteEnvelope {
  return {
    app: 'tessera',
    kind: 'settings',
    schema,
    key: '',
    rev,
    updatedAt: 1,
    writer: { deviceId: 'other', host: '', userAgent: '' },
    data,
  };
}

/** The remote key under which this mirror's device-wide record lives. */
function devKey(mirror: ReturnType<typeof createSettingsMirror>, name: string): string {
  return `dev:${mirror.deviceId()}:${name}`;
}

describe('settings-remote / key routing', () => {
  it('escapes dots so Moonraker does not read them as a path', () => {
    expect(decodeRemoteKey(encodeRemoteKey('plugin-settings:p1:tessera/a.b'))).toBe('plugin-settings:p1:tessera/a.b');
    expect(encodeRemoteKey('a.b')).not.toContain('.');
  });

  it('routes per-printer keys to that printer under a key with the local printer id', () => {
    expect(routeKey('mpu:v2:settings:p1', CTX)).toEqual({ printerId: 'p1', remoteKey: 'settings:p1' });
    expect(routeKey('mpu:v2:plugin-settings:p2:tessera/x', CTX)).toEqual({
      printerId: 'p2',
      remoteKey: 'plugin-settings:p2:tessera/x',
    });
    expect(localKeyFor('plugin-settings:p2:tessera/x', 'p2', CTX)).toBe('mpu:v2:plugin-settings:p2:tessera/x');
    // A record of some other printer id found in this DB is not ours
    expect(localKeyFor('plugin-settings:p9:tessera/x', 'p2', CTX)).toBeNull();
    expect(localKeyFor('settings:p1', 'p2', CTX)).toBeNull();
  });

  it('routes device-wide keys to the home printer under the device id', () => {
    expect(routeKey('mpu:v2:ui', CTX)).toEqual({ printerId: 'p1', remoteKey: 'dev:dev-1:ui' });
    expect(routeKey('mpu:v2:custom-font', CTX)).toEqual({ printerId: 'p1', remoteKey: 'dev:dev-1:custom-font' });
    expect(localKeyFor('dev:dev-1:custom-font', 'p1', CTX)).toBe('mpu:v2:custom-font');
    expect(routeKey('mpu:v2:plugin-settings:GLOBAL:tessera/x', CTX)).toEqual({
      printerId: 'p1',
      remoteKey: 'dev:dev-1:plugin-settings:GLOBAL:tessera/x',
    });
    expect(localKeyFor('dev:dev-1:plugin-settings:GLOBAL:tessera/x', 'p1', CTX)).toBe(
      'mpu:v2:plugin-settings:GLOBAL:tessera/x',
    );
    // Another device's record, and our record in a non-home DB, are ignored
    expect(localKeyFor('dev:dev-2:ui', 'p1', CTX)).toBeNull();
    expect(localKeyFor('dev:dev-1:ui', 'p2', CTX)).toBeNull();
  });

  it('never mirrors device-only keys', () => {
    for (const k of [
      'mpu:v2:printers',
      'mpu:v2:activePrinter',
      'mpu:v2:auth:p1',
      'mpu:v2:deviceId',
      'mpu:v2:settingsSync',
    ]) {
      expect(routeKey(k, CTX)).toBeNull();
    }
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
  it('syncs a font separately without adding it to later UI writes', async () => {
    const fm = fakeMoonraker();
    const a = setup(fm);
    await a.mirror.pull();
    const font = { name: 'sample.woff2', dataUrl: 'data:font/woff2;base64,d09GMg==' };
    a.mirror.storage.setItem('mpu:v2:custom-font', JSON.stringify(font));
    await a.mirror.flush();
    expect((fm.dbs.get(DB)?.[devKey(a.mirror, 'custom-font')] as RemoteEnvelope).data).toEqual(font);

    a.mirror.storage.setItem('mpu:v2:ui', JSON.stringify({ fontScale: 150 }));
    await a.mirror.flush();
    const uiRec = fm.dbs.get(DB)?.[devKey(a.mirror, 'ui')] as RemoteEnvelope;
    expect(JSON.stringify(uiRec.data)).not.toContain('data:font');
  });

  it('migrates existing local settings into an empty DB with app, rev and writer', async () => {
    const { fm, storage, mirror } = setup();
    storage.setItem('mpu:v2:settings:p1', JSON.stringify({ pages: { jobs: false } }));
    await mirror.pull();
    await mirror.flush();

    const rec = fm.dbs.get(DB)?.['settings:p1'] as RemoteEnvelope;
    expect(rec.app).toBe('tessera');
    expect(rec.kind).toBe('settings');
    expect(rec.schema).toBe(REMOTE_SCHEMA);
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
    const rec = fm.dbs.get(DB)?.['settings:p1'] as RemoteEnvelope;
    expect(rec.rev).toBe(2);
    expect(rec.data).toEqual({ n: 2 });
  });

  it('a browser that imported the printer list shares the per-printer records', async () => {
    const fm = fakeMoonraker();
    const a = setup(fm);
    await a.mirror.pull();
    a.mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 1 }));
    await a.mirror.flush();

    // The import copies mpu:v2 keys, so the second browser knows printer id p1 too.
    const b = setup(fm);
    const res = await b.mirror.pull();
    expect(res.changed).toBe(true);
    expect(JSON.parse(b.storage.getItem('mpu:v2:settings:p1')!)).toEqual({ n: 1 });
  });

  it('device-wide settings stay per device: another browser never sees the ui record', async () => {
    const fm = fakeMoonraker();
    const a = setup(fm);
    await a.mirror.pull();
    a.mirror.storage.setItem('mpu:v2:ui', JSON.stringify({ theme: 'dark' }));
    a.mirror.storage.setItem('mpu:v2:custom-font', JSON.stringify({ name: 'f.woff2' }));
    await a.mirror.flush();

    const b = setup(fm);
    const res = await b.mirror.pull();
    expect(res.keys).not.toContain('mpu:v2:ui');
    expect(res.keys).not.toContain('mpu:v2:custom-font');
    expect(b.storage.getItem('mpu:v2:ui')).toBeNull();
    // a's records stay untouched in the DB
    expect(fm.dbs.get(DB)?.[devKey(a.mirror, 'ui')]).toBeDefined();
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

    const rec = fm.dbs.get(DB)?.['settings:p1'] as RemoteEnvelope;
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
    expect(fm.dbs.get(DB)?.['settings:p1']).toBeDefined();
  });

  it('keeps the background image and device-only keys out of the DB', async () => {
    const { fm, storage, mirror } = setup();
    storage.setItem('mpu:v2:ui', JSON.stringify({ theme: 'dark', bgImage: 'data:image/png;base64,AAAA' }));
    storage.setItem('mpu:v2:auth:p1', JSON.stringify({ token: 'secret-token' }));
    await mirror.pull();
    await mirror.flush();

    const db = fm.dbs.get(DB) ?? {};
    expect((db[devKey(mirror, 'ui')] as RemoteEnvelope).data).toEqual({ theme: 'dark' });
    expect(JSON.stringify(db)).not.toContain('secret-token');
    expect(Object.keys(db).some((k) => k.includes('auth') || k.includes('printers'))).toBe(false);
  });

  it('ignores DB records that are not Tessera settings', async () => {
    const { fm, storage, mirror } = setup();
    fm.dbs.set(DB, { 'settings:p1': { foo: 1 } });
    await mirror.pull();
    expect(storage.getItem('mpu:v2:settings:p1')).toBeNull();
  });
});

describe('settings-remote / schema-2 migration', () => {
  it('adopts legacy records, deletes them and republishes under the addressed keys', async () => {
    const fm = fakeMoonraker();
    fm.dbs.set(DB, {
      // The id-less shared layout written by schema 2
      settings: envelope({ pages: { jobs: false } }, 4, 2),
      ui: envelope({ theme: 'dark' }, 2, 2),
    });
    const { storage, mirror } = setup(fm);
    // The local ui has a device-only background that must survive the adoption
    storage.setItem('mpu:v2:ui', JSON.stringify({ theme: 'light', bgImage: 'data:image/png;base64,BBBB' }));

    const res = await mirror.pull();
    expect(res.changed).toBe(true);
    expect(JSON.parse(storage.getItem('mpu:v2:settings:p1')!)).toEqual({ pages: { jobs: false } });
    expect(JSON.parse(storage.getItem('mpu:v2:ui')!)).toEqual({
      theme: 'dark',
      bgImage: 'data:image/png;base64,BBBB',
    });
    // Legacy records are gone, addressed records appear after the push
    await mirror.flush();
    const db = fm.dbs.get(DB) ?? {};
    expect(db.settings).toBeUndefined();
    expect(db.ui).toBeUndefined();
    const rec = db['settings:p1'] as RemoteEnvelope;
    expect(rec.schema).toBe(REMOTE_SCHEMA);
    expect(rec.rev).toBe(5); // the legacy lineage continues: max(0, 4) + 1
    expect((db[devKey(mirror, 'ui')] as RemoteEnvelope).rev).toBe(3);

    // A second pull does not re-apply anything
    expect((await mirror.pull()).changed).toBe(false);
  });

  it('a newer local edit survives the adoption of a stale legacy record', async () => {
    const fm = fakeMoonraker();
    fm.dbs.set(DB, { settings: envelope({ n: 'remote-old' }, 2, 2) });
    const { storage, mirror } = setup(fm);
    // A dirty edit existed before the pull (written through the wrapper)
    mirror.storage.setItem('mpu:v2:settings:p1', JSON.stringify({ n: 'local-new' }));

    await mirror.pull();
    expect(JSON.parse(storage.getItem('mpu:v2:settings:p1')!)).toEqual({ n: 'local-new' });
    await mirror.flush();
    expect(fm.dbs.get(DB)?.settings).toBeUndefined();
    expect((fm.dbs.get(DB)?.['settings:p1'] as RemoteEnvelope).data).toEqual({ n: 'local-new' });
  });

  it('upgrades the legacy bare meta map and republishes the known keys', async () => {
    const fm = fakeMoonraker();
    const storage = new MemoryStorage();
    storage.setItem('mpu:v2:printers', JSON.stringify(PRINTERS));
    storage.setItem('mpu:v2:settings:p1', JSON.stringify({ pages: { jobs: false } }));
    // Schema-2 bookkeeping: a bare key → entry map without a version
    storage.setItem('mpu:v2:remote-meta', JSON.stringify({ 'mpu:v2:settings:p1': { rev: 3, updatedAt: 1 } }));

    const mirror = createSettingsMirror({ storage, fetch: fm.fetch, origin: DB, pushDelayMs: 1 });
    // The meta file is rewritten in the versioned form
    const saved = JSON.parse(storage.getItem('mpu:v2:remote-meta')!);
    expect(saved.v).toBe(3);
    expect(saved.entries['mpu:v2:settings:p1'].dirty).toBe(true);

    await mirror.flush();
    const rec = fm.dbs.get(DB)?.['settings:p1'] as RemoteEnvelope;
    expect(rec.schema).toBe(REMOTE_SCHEMA);
    expect(rec.rev).toBe(4); // the lineage continues above the legacy rev
  });
});
