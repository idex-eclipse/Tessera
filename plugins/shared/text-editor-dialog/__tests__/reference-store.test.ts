import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import { clearReferenceCache, classifyReferenceError, loadReference } from '../reference-store';

const DOC = '## Group\n\n### [mcu]\n\nPrimary micro-controller.\n\n### [printer]\n\nBasics.\n';

function fakeApi(id: string, token: string | null = null): PluginApi {
  return {
    printer: { id, name: id, url: `http://${id}` },
    moonraker: () => ({ httpBaseUrl: `http://${id}:7125`, authToken: token }),
  } as unknown as PluginApi;
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (body: string) => Promise.resolve({ ok: true, status: 200, text: async () => body });
const http = (status: number) => Promise.resolve({ ok: false, status, text: async () => '' });

describe('loadReference', () => {
  beforeEach(() => clearReferenceCache());
  afterEach(() => vi.unstubAllGlobals());

  it('читает docs/Config_Reference.md с Bearer-токеном и строит индекс', async () => {
    const fetchMock = stubFetch(() => ok(DOC));
    const index = await loadReference(fakeApi('p1', 'tok'));
    expect([...index.byKey.keys()]).toEqual(['mcu', 'printer']);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('http://p1:7125/server/files/docs/Config_Reference.md')).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('кеширует по принтеру: повторный вызов не ходит в сеть', async () => {
    const fetchMock = stubFetch(() => ok(DOC));
    const api = fakeApi('p1');
    const a = await loadReference(api);
    const b = await loadReference(api);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await loadReference(fakeApi('p2'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('параллельные вызовы схлопываются в один запрос', async () => {
    const fetchMock = stubFetch(() => ok(DOC));
    const api = fakeApi('p1');
    const [a, b] = await Promise.all([loadReference(api), loadReference(api)]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ошибку не кешируем: следующий вызов пробует снова', async () => {
    let calls = 0;
    stubFetch(() => (++calls === 1 ? http(404) : ok(DOC)));
    const api = fakeApi('p1');
    await expect(loadReference(api)).rejects.toThrow('HTTP 404');
    await expect(loadReference(api)).resolves.toBeDefined();
    expect(calls).toBe(2);
  });

  it('нет активного принтера (moonraker() бросает) — это reject, а не исключение', async () => {
    const api = {
      printer: { id: 'p1' },
      moonraker: () => {
        throw new Error('No active printer');
      },
    } as unknown as PluginApi;
    await expect(loadReference(api)).rejects.toThrow('No active printer');
  });
});

describe('classifyReferenceError', () => {
  it('401/403/404 — справка недоступна, остальное — ошибка', () => {
    for (const code of [401, 403, 404]) {
      expect(classifyReferenceError(new Error(`HTTP ${code}`)).kind).toBe('unavailable');
    }
    expect(classifyReferenceError(new Error('HTTP 500')).kind).toBe('error');
    expect(classifyReferenceError(new Error('HTTP 4040')).kind).toBe('error');
    expect(classifyReferenceError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'error',
      message: 'Failed to fetch',
    });
    expect(classifyReferenceError('boom').message).toBe('boom');
  });
});
