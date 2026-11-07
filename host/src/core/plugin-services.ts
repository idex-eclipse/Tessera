import type {
  PluginManifest,
  PluginServicesApi,
  ServiceError,
  ServiceRequestInit,
  ServiceStatus,
} from '../../../plugin-sdk/src/types';


/**
 * api.services: the client of the service proxy in deploy/tessera-ext.py
 * (/tessera-api/v1/services/<plugin>/<name>[/proxy/<path>]).
 *
 * The proxy belongs to the Tessera host, like plugin installs: it is authorized with the
 * Moonraker token of the printer this host serves (host-printer.ts), whatever printer is
 * active. Every request names its plugin in X-Tessera-Plugin: the service refuses requests
 * without it, so a plain cross-site form or <img> cannot use the proxy.
 */

const API_BASE = '/tessera-api/v1/services';
/** Marks answers that come from the service itself (UPSTREAM_MARK in tessera-ext.py). */
const UPSTREAM_MARK = 'X-Tessera-Service';
const PLUGIN_HEADER = 'X-Tessera-Plugin';
/** Headers of a plugin request the proxy forwards (PROXY_REQUEST_HEADERS); the rest is dropped here. */
const FORWARDED = new Set(['accept', 'accept-language', 'content-type']);

/** A ServiceError (see the SDK): plugins tell it by `name`, they cannot import a class. */
export function serviceError(message: string, status: number, unavailable = false): ServiceError {
  const error = new Error(message) as ServiceError;
  error.name = 'ServiceError';
  error.status = status;
  error.unavailable = unavailable;
  return error;
}

export interface ServicesDeps {
  getToken: () => string | null;
  /** For tests. Default: the global fetch. */
  fetch?: typeof fetch;
}

export function createServicesApi(pluginId: string, manifest: PluginManifest, deps: ServicesDeps): PluginServicesApi {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = `${API_BASE}/${encodeURIComponent(pluginId)}`;

  /** Declared names are checked here only for a clear message: the service checks them anyway. */
  function checkName(name: string): void {
    if (!manifest.services?.some((s) => s?.name === name)) {
      throw serviceError(`Service "${name}" is not declared in manifest.services of ${pluginId}`, 404);
    }
  }

  function headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra, [PLUGIN_HEADER]: pluginId };
    const token = deps.getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw serviceError('The service proxy of Tessera is not reachable', 0, true);
    }
  }

  /** A refusal of the proxy → ServiceError; anything that is not its JSON means "no proxy". */
  async function refusal(res: Response): Promise<ServiceError> {
    let message: unknown;
    try {
      message = ((await res.json()) as { error?: unknown }).error;
    } catch {
      message = undefined;
    }
    if (typeof message !== 'string') {
      // 404/502 page of nginx or the dev server: this Tessera has no proxy.
      return serviceError('This Tessera has no service proxy (tessera-ext service)', 0, true);
    }
    return serviceError(message, res.status);
  }

  /** Config routes: JSON in, JSON out, any non-2xx is a refusal. */
  async function call<T>(method: string, name: string, body?: unknown): Promise<T> {
    checkName(name);
    const res = await send(`${base}/${name}`, {
      method,
      headers: headers(body === undefined ? undefined : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await refusal(res);
    try {
      return (await res.json()) as T;
    } catch {
      throw serviceError('This Tessera has no service proxy (tessera-ext service)', 0, true);
    }
  }

  return {
    status(name) {
      return call<ServiceStatus>('GET', name);
    },

    configure(name, config) {
      const body: { url: string; secret?: string } = { url: config.url };
      if (typeof config.secret === 'string') body.secret = config.secret;
      return call<ServiceStatus>('PUT', name, body);
    },

    async remove(name) {
      await call<unknown>('DELETE', name);
    },

    async fetch(name: string, path: string, init: ServiceRequestInit = {}): Promise<Response> {
      checkName(name);
      // The path goes as given (already encoded by the plugin); a leading slash is tolerated.
      const rel = path.replace(/^\/+/, '');
      // A plugin must not set Authorization (Moonraker's) or name another plugin.
      const own = Object.fromEntries(Object.entries(init.headers ?? {}).filter(([k]) => FORWARDED.has(k.toLowerCase())));
      const res = await send(`${base}/${name}/proxy/${rel}`, {
        method: init.method ?? 'GET',
        headers: headers(own),
        body: init.body ?? undefined,
        signal: init.signal,
      });
      if (res.headers.get(UPSTREAM_MARK) === 'upstream') return res;
      throw await refusal(res);
    },
  };
}
