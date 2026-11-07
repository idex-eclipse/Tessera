import { describe, expect, it, vi } from 'vitest';

import type { PluginManifest, ServiceError } from '../../../../plugin-sdk/src/types';
import { createServicesApi } from '../plugin-services';

/** api.services against a faked /tessera-api/v1/services of deploy/tessera-ext.py. */

const manifest = {
  id: 'acme/svc',
  name: 'Svc',
  version: '1.0.0',
  entry: 'index.js',
  services: [{ name: 'obico', authHeader: 'X-Api-Key', allowPaths: ['api/v1/'] }],
} as PluginManifest;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function setup(respond: (url: string, init: RequestInit) => Response | Promise<Response>, token: string | null = 'tok') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init ?? {}));
  const api = createServicesApi('acme/svc', manifest, { getToken: () => token, fetch: fetchMock as typeof fetch });
  return { api, fetchMock };
}

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

async function rejection(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p;
  } catch (e) {
    return e as ServiceError;
  }
  throw new Error('expected a rejection');
}

describe('api.services', () => {
  it('configures and reads a service with the host token and the plugin header', async () => {
    const view = { name: 'obico', configured: true, url: 'http://obico:3334', hasSecret: true };
    const { api, fetchMock } = setup(() => json(200, view));

    expect(await api.configure('obico', { url: 'http://obico:3334', secret: 's' })).toEqual(view);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/tessera-api/v1/services/acme%2Fsvc/obico');
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(String(init!.body))).toEqual({ url: 'http://obico:3334', secret: 's' });
    expect(headersOf(init!)).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Tessera-Plugin': 'acme/svc',
      'Content-Type': 'application/json',
    });

    // No secret given: the body has none, so the service keeps the saved one.
    await api.configure('obico', { url: 'http://obico:3334' });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({ url: 'http://obico:3334' });

    expect(await api.status('obico')).toEqual(view);
    expect(fetchMock.mock.calls[2]![1]!.method).toBe('GET');
  });

  it('returns answers of the service as they are, errors included', async () => {
    const { api, fetchMock } = setup(() => json(404, { detail: 'Not found.' }, { 'X-Tessera-Service': 'upstream' }));
    const res = await api.fetch('obico', '/api/v1/printers/?with_archived=true', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer evil', 'X-Tessera-Plugin': 'other/plugin' },
      body: '{}',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ detail: 'Not found.' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/tessera-api/v1/services/acme%2Fsvc/obico/proxy/api/v1/printers/?with_archived=true');
    // The plugin can neither replace the Moonraker token nor speak for another plugin.
    expect(headersOf(init!)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
      'X-Tessera-Plugin': 'acme/svc',
    });
  });

  it('turns refusals of the proxy into a ServiceError', async () => {
    const { api } = setup(() => json(403, { error: 'Path not allowed by the plugin manifest: admin/' }));
    const e = await rejection(api.fetch('obico', 'admin/'));
    expect(e).toMatchObject({ name: 'ServiceError', status: 403, unavailable: false });
    expect(e.message).toContain('not allowed');
  });

  it('reports a Tessera without the proxy as unavailable', async () => {
    for (const respond of [
      () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      () => new Response('<!doctype html>', { status: 200 }),
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]) {
      const { api } = setup(respond);
      expect(await rejection(api.status('obico'))).toMatchObject({ name: 'ServiceError', status: 0, unavailable: true });
      expect(await rejection(api.fetch('obico', 'api/v1/'))).toMatchObject({ unavailable: true });
    }
  });

  it('refuses services the manifest does not declare, without a request', async () => {
    const { api, fetchMock } = setup(() => json(200, {}));
    expect(await rejection(api.fetch('other', 'api/v1/'))).toMatchObject({ status: 404 });
    expect(await rejection(api.remove('other'))).toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no Authorization when the host has no login', async () => {
    const { api, fetchMock } = setup(() => json(200, { changed: true }), null);
    await api.remove('obico');
    expect(headersOf(fetchMock.mock.calls[0]![1]!)).toEqual({ 'X-Tessera-Plugin': 'acme/svc' });
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('DELETE');
  });
});
