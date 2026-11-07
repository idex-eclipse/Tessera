import { readStoredAuth } from './auth-store.svelte.ts';

/**
 * The printer whose Moonraker serves this Tessera host. Its token authorizes requests to the
 * host's own services (/tessera-api/, /tessera-update/): plugin installs, updates and the
 * plugin service proxy. A separate module so that the plugin API does not import the
 * installer (and, through it, the extensions catalog, which fetches on import).
 */

/**
 * Принтер, чей Moonraker обслуживает этот хост. Запись по умолчанию — http://<хост>:7125
 * (settings-store), поэтому главный признак — совпадение hostname, а не origin страницы.
 */
export function findHostPrinter<T extends { url: string }>(
  printers: readonly T[],
  location: { origin: string; hostname: string },
): T | null {
  const parse = (url: string): URL | null => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  };
  return (
    printers.find((p) => parse(p.url)?.origin === location.origin) ??
    printers.find((p) => parse(p.url)?.hostname === location.hostname) ??
    null
  );
}

/** Moonraker token of the printer served by this host; null without a login (trusted client). */
export function hostMoonrakerToken(printers: readonly { id: string; url: string }[]): string | null {
  const host = findHostPrinter(printers, window.location);
  return host ? (readStoredAuth(host.id)?.token ?? null) : null;
}
