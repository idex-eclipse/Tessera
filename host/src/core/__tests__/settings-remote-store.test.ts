import { describe, expect, it } from 'vitest';

import { MemoryStorage } from '../storage';
import { createSettingsMirror } from '../settings-remote';
import { createSettingsStore } from '../settings-store.svelte.ts';

/** Fake Moonraker per base URL (same shape as the real database endpoints). */
function fakeMoonraker() {
  const dbs = new Map<string, Record<string, unknown>>();
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const db = dbs.get(url.origin) ?? {};
    dbs.set(url.origin, db);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { key: string; value: unknown };
      db[body.key] = body.value;
      return new Response('{"result":{}}', { status: 200 });
    }
    const key = url.searchParams.get('key');
    if (key === null) return new Response(JSON.stringify({ result: { value: db } }), { status: 200 });
    return key in db
      ? new Response(JSON.stringify({ result: { value: db[key] } }), { status: 200 })
      : new Response('{}', { status: 404 });
  };
  return fetchImpl as typeof fetch;
}

const A = 'http://printer-a:7125';
const B = 'http://printer-b:7125';

/** One browser: its own storage, mirror and settings store, like main.ts builds them. */
async function boot(storage: MemoryStorage, fetchImpl: typeof fetch) {
  const mirror = createSettingsMirror({ storage, fetch: fetchImpl, origin: A, pushDelayMs: 1 });
  await mirror.pull();
  const store = createSettingsStore({ storage: mirror.storage, createDefaultPrinter: false });
  return { mirror, store, storage };
}

describe('settings mirror + store, two browsers and two printers', () => {
  it('a change made in browser 1 shows up in browser 2 after pull + reloadFromStorage', async () => {
    const fetchImpl = fakeMoonraker();

    // Browser 1 owns two printers.
    const s1 = new MemoryStorage();
    s1.setItem('mpu:v2:printers', JSON.stringify([
      { id: 'p1', name: 'A', url: A },
      { id: 'p2', name: 'B', url: B },
    ]));
    const b1 = await boot(s1, fetchImpl);
    await b1.mirror.flush();

    // Browser 2 imported the same printer list (export/import copies mpu:v2 keys).
    const s2 = new MemoryStorage();
    for (let i = 0; i < s1.length; i += 1) {
      const k = s1.key(i)!;
      if (k === 'mpu:v2:deviceId' || k === 'mpu:v2:remote-meta') continue;
      s2.setItem(k, s1.getItem(k)!);
    }
    const b2 = await boot(s2, fetchImpl);
    expect(b2.store.getPageVisibility('p2', 'jobs')).toBe(true);

    // Browser 1 hides a page of printer 2.
    b1.store.setPageVisibility('p2', 'jobs', false);
    await b1.mirror.flush();

    // Browser 2 switches printer: the host runs pullNow() and reloadFromStorage().
    const r = await b2.mirror.pullNow();
    expect(r.changed).toBe(true);
    expect(r.keys).toContain('mpu:v2:settings:p2');
    b2.store.reloadFromStorage();
    expect(b2.store.getPageVisibility('p2', 'jobs')).toBe(false);
  });
});
