import { describe, expect, it, vi } from 'vitest';

import { createUiUpdater, UiUpdaterError, type UiUpdateStatus } from '../ui-updater.svelte.ts';

const status: UiUpdateStatus = {
  installed: { commit: 'aaaaaaa', branch: 'main', date: '2025-12-01', version: '1.0.0' },
  remote: { commit: 'bbbbbbb', branch: 'main', date: '2026-01-01', version: '1.1.0' },
  branch: 'main',
  updateAvailable: true,
  canUpdate: true,
  remoteError: null,
};

function json(code: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
}

function setup(respond: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return respond(String(input).replace('/tessera-update/v1/', ''), init ?? {});
  });
  let token: string | null = null;
  const updater = createUiUpdater({
    getToken: () => token,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { updater, fetchMock, setToken: (t: string | null) => (token = t) };
}

describe('ui-updater / availability', () => {
  it('the service answered: the block is available and the status is kept', async () => {
    const { updater } = setup(() => json(200, status));
    await updater.refresh();
    expect(updater.available).toBe(true);
    expect(updater.status).toEqual(status);
  });

  it('nginx 502 (no service): not available, no error shown', async () => {
    const { updater } = setup(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    await updater.refresh();
    expect(updater.available).toBe(false);
    expect(updater.error).toBeNull();
  });

  it('network failure: not available', async () => {
    const { updater } = setup(() => Promise.reject(new TypeError('network')));
    await updater.refresh();
    expect(updater.available).toBe(false);
  });

  it('the service refused (401): the block stays visible with the reason', async () => {
    const { updater } = setup(() => json(401, { error: 'Unauthorized: log in to this printer' }));
    await updater.refresh();
    expect(updater.available).toBe(true);
    expect(updater.status).toBeNull();
    expect(updater.error).toBeInstanceOf(UiUpdaterError);
    expect(updater.error?.status).toBe(401);
  });

  it('forced refresh asks the service to skip its cache', async () => {
    const { updater, fetchMock } = setup(() => json(200, status));
    await updater.refresh();
    await updater.refresh(true);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/tessera-update/v1/status');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/tessera-update/v1/status?refresh=1');
  });

  it('forwards the Moonraker token', async () => {
    const { updater, fetchMock, setToken } = setup(() => json(200, status));
    setToken('abc');
    await updater.refresh();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });
});

describe('ui-updater / branches', () => {
  it('keeps the list of branches', async () => {
    const { updater } = setup(() => json(200, { current: 'main', branches: ['dev', 'main'], error: null }));
    await updater.loadBranches();
    expect(updater.branches).toEqual(['dev', 'main']);
    expect(updater.branchesError).toBeNull();
  });

  it('a failure leaves an empty list and the reason', async () => {
    const { updater } = setup(() => json(401, { error: 'Unauthorized' }));
    await updater.loadBranches();
    expect(updater.branches).toEqual([]);
    expect(updater.branchesError).toBe('Unauthorized');
  });
});

describe('ui-updater / update', () => {
  it('posts an empty object, then re-reads the status', async () => {
    const { updater, fetchMock } = setup((path) =>
      path === 'update' ? json(200, { changed: true, from: 'aaaaaaa', to: 'bbbbbbb' }) : json(200, status),
    );
    expect(await updater.update()).toBe(true);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/tessera-update/v1/status');
    expect(updater.busy).toBe(false);
  });

  it('switching a branch posts the branch name', async () => {
    const { updater, fetchMock } = setup((path) =>
      path === 'update' ? json(200, { changed: true, from: 'aaaaaaa', to: 'bbbbbbb' }) : json(200, status),
    );
    expect(await updater.update('dev')).toBe(true);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBe('{"branch":"dev"}');
  });

  it('nothing to update: false, no error', async () => {
    const { updater } = setup((path) =>
      path === 'update' ? json(200, { changed: false, from: 'aaaaaaa', to: 'aaaaaaa' }) : json(200, status),
    );
    expect(await updater.update()).toBe(false);
    expect(updater.error).toBeNull();
  });

  it('a refusal is reported in error and the status is kept for the UI', async () => {
    const { updater } = setup((path) =>
      path === 'update' ? json(502, { error: 'sha256 of the downloaded build does not match build-info' }) : json(200, status),
    );
    expect(await updater.update()).toBe(false);
    expect(updater.error?.message).toContain('sha256');
    expect(updater.error?.status).toBe(502);
    expect(updater.busy).toBe(false);
  });

  it('a second call while one runs is ignored', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { updater, fetchMock } = setup(async (path) => {
      if (path !== 'update') return json(200, status);
      await gate;
      return json(200, { changed: true, from: 'a', to: 'b' });
    });
    const first = updater.update();
    expect(await updater.update()).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/update'))).toHaveLength(1);
  });
});
