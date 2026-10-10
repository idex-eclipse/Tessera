import type { MoonrakerProxy } from './moonraker-proxy';

/**
 * Host-level auth-инфраструктура (решение: пароль не попадает в плагины).
 * Токен per-printer в mpu:v2:auth:<printerId>; AuthOverlay хоста при 401;
 * logout из правой панели событием mpu:auth-logout.
 */

export interface StoredAuth {
  token: string;
  refreshToken?: string;
  user?: string;
}

const key = (printerId: string) => `mpu:v2:auth:${printerId}`;

let authRequiredPrinterId = $state<string | null>(null);
const proxies = new Map<string, MoonrakerProxy>();

function readJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readStoredAuth(printerId: string): StoredAuth | null {
  try {
    return readJson<StoredAuth>(localStorage.getItem(key(printerId)));
  } catch {
    return null;
  }
}

function writeStoredAuth(printerId: string, auth: StoredAuth): void {
  try {
    localStorage.setItem(key(printerId), JSON.stringify(auth));
  } catch {
    // ignore
  }
}

function clearStoredAuth(printerId: string): void {
  try {
    localStorage.removeItem(key(printerId));
  } catch {
    // ignore
  }
}

export function getAuthRequiredPrinterId(): string | null {
  return authRequiredPrinterId;
}

/**
 * Вызывается printer-manager в attachPrinter сразу после getMoonrakerProxy:
 * поднимает сохранённый токен и подписывается на 401.
 */
export function bindProxyToAuth(printerId: string, proxy: MoonrakerProxy): void {
  proxies.set(printerId, proxy);

  const stored = readStoredAuth(printerId);
  if (stored?.token) {
    proxy.setAuthToken(stored.token);
  }

  proxy.onAuthRequired(() => {
    console.log('[auth-store] onAuthRequired fired for printer:', printerId);
    authRequiredPrinterId = printerId;
    console.log('[auth-store] authRequiredPrinterId set to:', authRequiredPrinterId);
  });
}

export async function login(
  printerId: string,
  httpBaseUrl: string,
  username: string,
  password: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${httpBaseUrl}/access/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return false;

    const data = (await res.json()) as any;
    const token = data?.token ?? data?.result?.token;
    if (typeof token !== 'string' || token.length === 0) return false;

    writeStoredAuth(printerId, {
      token,
      refreshToken: data?.refresh_token ?? data?.result?.refresh_token,
      user: username,
    });

    authRequiredPrinterId = null;
    proxies.get(printerId)?.setAuthToken(token);
    return true;
  } catch {
    return false;
  }
}

export function logout(printerId: string): void {
  const proxy = proxies.get(printerId);
  const tok = readStoredAuth(printerId)?.token;

  clearStoredAuth(printerId);
  authRequiredPrinterId = printerId;

  if (tok && proxy) {
    fetch(`${proxy.httpBaseUrl}/access/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}` },
    }).catch(() => {});
  }

  proxy?.setAuthToken(null);
}

// plugin → host контракт logout (правая панель @core/system)
if (typeof window !== 'undefined') {
  window.addEventListener('mpu:auth-logout', (e) => {
    const id = (e as CustomEvent).detail?.printerId;
    if (typeof id === 'string') logout(id);
  });
}