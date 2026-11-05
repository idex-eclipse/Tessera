/**
 * Mirror of the Tessera settings in the Moonraker database.
 *
 * `localStorage` stays the synchronous working copy (the settings store reads and
 * writes it exactly as before). This module copies the synced keys to the
 * `tessera` namespace of the printer's Moonraker DB and pulls newer copies back, so
 * the settings survive a browser change. Without a reachable Moonraker everything
 * keeps working from `localStorage` alone.
 *
 * Why it is plain HTTP and not the Moonraker proxy: the pull must finish *before*
 * the settings store is created (the store reads `localStorage` once at start), and
 * the proxy needs the store's printer list first.
 *
 * Conflict rule: last write wins, ordered by a revision counter (`rev`). A write
 * reads the remote revision first and publishes `max(remote, local) + 1`, so a stale
 * browser can never produce a lower revision than the one it overwrites.
 *
 * Kept on the device only (needed before Moonraker is reachable, or secret / per
 * device): the printer list, the active printer, auth tokens, the device id, the
 * sync flags and the background image.
 */

import type { StorageLike } from './storage';

/** Moonraker DB namespace that holds the mirrored settings. */
export const REMOTE_NAMESPACE = 'tessera';

const KEY_PREFIX = 'mpu:v2:';
const META_KEY = 'mpu:v2:remote-meta';
const DEVICE_ID_KEY = 'mpu:v2:deviceId';
const PRINTERS_KEY = 'mpu:v2:printers';
const GLOBAL_SETTINGS = 'settings:GLOBAL';
const GLOBAL_PLUGIN_PREFIX = 'plugin-settings:GLOBAL:';
const PLUGIN_PREFIX = 'plugin-settings:';

/** Debounce for pushes: a slider drag must not become dozens of DB writes. */
const PUSH_DELAY_MS = 500;
/** Do not pull more often than this on window focus. */
const FOCUS_PULL_MIN_MS = 10_000;

/** Who wrote a record; there is no way to learn the client IP from a browser. */
export interface RemoteWriter {
  deviceId: string;
  host: string;
  userAgent: string;
}

/** A record as stored in the Moonraker DB. `app` / `kind` mark it as Tessera settings. */
export interface RemoteEnvelope {
  app: 'tessera';
  kind: 'settings';
  schema: 2;
  /** The original `localStorage` key, for humans reading the DB. */
  key: string;
  rev: number;
  updatedAt: number;
  writer: RemoteWriter;
  /** The stored JSON value; `null` means the key was removed. */
  data: unknown;
}

interface MetaEntry {
  rev: number;
  updatedAt: number;
  /** A local change that is not in the DB yet. */
  dirty?: boolean;
}

interface PrinterRef {
  id: string;
  url: string;
}

export interface MirrorOptions {
  /** The device storage (localStorage). */
  storage: StorageLike;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** For tests: the page origin used to pick the "home" printer. */
  origin?: string;
  /** For tests. */
  now?: () => number;
  /** For tests: the push debounce. */
  pushDelayMs?: number;
}

/** Where a local key lives in the DB: which printer and under which remote key. */
export interface KeyRoute {
  printerId: string;
  remoteKey: string;
}

// ---------------------------------------------------------------------------
// Key routing
// ---------------------------------------------------------------------------

/** Moonraker reads "." in a key as a path separator, so it is escaped. */
export function encodeRemoteKey(key: string): string {
  return key.replace(/%/g, '%25').replace(/\./g, '%2E');
}

export function decodeRemoteKey(key: string): string {
  return key.replace(/%2E/g, '.').replace(/%25/g, '%');
}

/**
 * Maps a `localStorage` key to its place in the DB, or null when the key is not
 * mirrored. Per-printer data goes to that printer's own DB *without* the local
 * printer id (ids differ between browsers; the DB itself identifies the printer).
 * Everything else lives in the DB of the home printer.
 */
export function routeKey(localKey: string, homePrinterId: string | null): KeyRoute | null {
  if (!localKey.startsWith(KEY_PREFIX)) return null;
  const rest = localKey.slice(KEY_PREFIX.length);

  if (rest === 'ui' || rest === 'plugins' || rest === 'editor-colors' || rest === GLOBAL_SETTINGS) {
    return homePrinterId ? { printerId: homePrinterId, remoteKey: rest } : null;
  }
  if (rest.startsWith(GLOBAL_PLUGIN_PREFIX)) {
    return homePrinterId ? { printerId: homePrinterId, remoteKey: rest } : null;
  }
  if (rest.startsWith('settings:')) {
    const printerId = rest.slice('settings:'.length);
    return printerId ? { printerId, remoteKey: 'settings' } : null;
  }
  if (rest.startsWith(PLUGIN_PREFIX)) {
    const tail = rest.slice(PLUGIN_PREFIX.length);
    const sep = tail.indexOf(':');
    if (sep <= 0 || sep === tail.length - 1) return null;
    return {
      printerId: tail.slice(0, sep),
      remoteKey: `${PLUGIN_PREFIX}${tail.slice(sep + 1)}`,
    };
  }
  return null;
}

/**
 * Inverse of {@link routeKey} for a record found in a printer's DB. Global keys are
 * only accepted from the home printer's DB.
 */
export function localKeyFor(
  remoteKey: string,
  printerId: string,
  homePrinterId: string | null,
): string | null {
  if (remoteKey === 'settings') return `${KEY_PREFIX}settings:${printerId}`;
  if (remoteKey.startsWith(GLOBAL_PLUGIN_PREFIX) || remoteKey === GLOBAL_SETTINGS) {
    return printerId === homePrinterId ? `${KEY_PREFIX}${remoteKey}` : null;
  }
  if (remoteKey.startsWith(PLUGIN_PREFIX)) {
    return `${KEY_PREFIX}${PLUGIN_PREFIX}${printerId}:${remoteKey.slice(PLUGIN_PREFIX.length)}`;
  }
  if (remoteKey === 'ui' || remoteKey === 'plugins' || remoteKey === 'editor-colors') {
    return printerId === homePrinterId ? `${KEY_PREFIX}${remoteKey}` : null;
  }
  return null;
}

/**
 * The printer that serves this page (same origin), else the first one. Global
 * settings are kept in its DB.
 */
export function pickHomePrinter(printers: PrinterRef[], origin: string): string | null {
  const norm = (u: string): string => u.trim().replace(/\/+$/, '');
  const same = printers.find((p) => norm(p.url) === norm(origin));
  return (same ?? printers[0])?.id ?? null;
}

// ---------------------------------------------------------------------------
// Value transforms
// ---------------------------------------------------------------------------

/** The background image is big and device specific: it never leaves the device. */
function toRemoteValue(localKey: string, value: unknown): unknown {
  if (localKey === `${KEY_PREFIX}ui` && value && typeof value === 'object' && !Array.isArray(value)) {
    const { bgImage: _skip, ...rest } = value as Record<string, unknown>;
    return rest;
  }
  return value;
}

/** Applies a remote value over the local one, keeping the device-only fields. */
function fromRemoteValue(localKey: string, remote: unknown, local: unknown): unknown {
  if (
    localKey === `${KEY_PREFIX}ui` &&
    remote && typeof remote === 'object' && !Array.isArray(remote) &&
    local && typeof local === 'object' && !Array.isArray(local) &&
    'bgImage' in (local as Record<string, unknown>)
  ) {
    return { ...(remote as Record<string, unknown>), bgImage: (local as Record<string, unknown>).bgImage };
  }
  return remote;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isEnvelope(value: unknown): value is RemoteEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.app === 'tessera' && v.kind === 'settings' && typeof v.rev === 'number' && 'data' in v;
}

// ---------------------------------------------------------------------------
// Mirror
// ---------------------------------------------------------------------------

/** Receives local writes made behind the wrapper's back (see settings-sync). */
let activeNotify: ((key: string) => void) | null = null;

/** Tells the active mirror that a mirrored key was written directly to localStorage. */
export function notifyLocalWrite(key: string): void {
  activeNotify?.(key);
}

export interface PullResult {
  /** Some local key was replaced by a newer remote copy. */
  changed: boolean;
  /** The local keys that were replaced. */
  keys: string[];
  /** There were no printers to ask yet. */
  noPrinters: boolean;
}

export type SettingsMirror = ReturnType<typeof createSettingsMirror>;

export function createSettingsMirror(options: MirrorOptions) {
  const inner = options.storage;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  const pushDelay = options.pushDelayMs ?? PUSH_DELAY_MS;
  const origin = options.origin ?? (typeof location !== 'undefined' ? location.origin : '');

  let meta: Record<string, MetaEntry> = loadMeta();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pushing: Promise<void> | null = null;
  let lastFocusPull = 0;

  function loadMeta(): Record<string, MetaEntry> {
    const v = parseJson(inner.getItem(META_KEY));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, MetaEntry>) : {};
  }

  function saveMeta(): void {
    try {
      inner.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // Storage full or blocked: the mirror just forgets what it knew.
    }
  }

  function readPrinters(): PrinterRef[] {
    const v = parseJson(inner.getItem(PRINTERS_KEY));
    if (!Array.isArray(v)) return [];
    return v.filter(
      (p): p is PrinterRef =>
        !!p && typeof (p as PrinterRef).id === 'string' && typeof (p as PrinterRef).url === 'string',
    );
  }

  /** Stable per-browser id; never exported, so an import cannot clone it. */
  function deviceId(): string {
    try {
      const existing = inner.getItem(DEVICE_ID_KEY);
      if (existing) return existing;
    } catch {
      // Fall through to a fresh id.
    }
    const c = (globalThis as { crypto?: Crypto }).crypto;
    const id =
      c && typeof c.randomUUID === 'function'
        ? c.randomUUID()
        : `dev-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      inner.setItem(DEVICE_ID_KEY, id);
    } catch {
      // Not persisted: a new id next time, harmless.
    }
    return id;
  }

  function writer(): RemoteWriter {
    return {
      deviceId: deviceId(),
      host: typeof location !== 'undefined' ? location.host : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 160) : '',
    };
  }

  function baseUrl(p: PrinterRef): string {
    return p.url.trim().replace(/\/+$/, '');
  }

  function authHeaders(printerId: string): Record<string, string> {
    const auth = parseJson(inner.getItem(`mpu:v2:auth:${printerId}`)) as { token?: string } | undefined;
    return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
  }

  /** Reads the whole `tessera` namespace of a printer; null when unreachable. */
  async function readNamespace(
    p: PrinterRef,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await doFetch(
        `${baseUrl(p)}/server/database/item?namespace=${REMOTE_NAMESPACE}`,
        { headers: authHeaders(p.id), cache: 'no-store', signal },
      );
      // 404: the namespace does not exist yet, which is a valid empty state.
      if (res.status === 404) return {};
      if (!res.ok) {
        console.warn(`[settings-remote] ${baseUrl(p)}: namespace read refused (HTTP ${res.status})`);
        return null;
      }
      const body = (await res.json()) as { result?: { value?: unknown } };
      const value = body.result?.value;
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    } catch (e) {
      // Most often CORS (cors_domains in moonraker.conf) or the printer being offline
      console.warn(`[settings-remote] ${baseUrl(p)}: namespace read failed`, e);
      return null;
    }
  }

  async function readItem(p: PrinterRef, remoteKey: string): Promise<unknown | null | undefined> {
    try {
      const res = await doFetch(
        `${baseUrl(p)}/server/database/item?namespace=${REMOTE_NAMESPACE}&key=${encodeURIComponent(encodeRemoteKey(remoteKey))}`,
        { headers: authHeaders(p.id), cache: 'no-store' },
      );
      if (res.status === 404) return null; // no such item yet
      if (!res.ok) return undefined; // unreachable / refused: do not guess
      const body = (await res.json()) as { result?: { value?: unknown } };
      return body.result?.value ?? null;
    } catch {
      return undefined;
    }
  }

  async function writeItem(p: PrinterRef, remoteKey: string, value: RemoteEnvelope): Promise<boolean> {
    try {
      const res = await doFetch(`${baseUrl(p)}/server/database/item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(p.id) },
        body: JSON.stringify({ namespace: REMOTE_NAMESPACE, key: encodeRemoteKey(remoteKey), value }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ----- local change tracking ------------------------------------------

  /** Called for every write of a mirrored key; schedules a push. */
  function markDirty(key: string): void {
    if (!routeKey(key, 'x')) return; // not a mirrored key
    meta = { ...meta, [key]: { rev: meta[key]?.rev ?? 0, updatedAt: now(), dirty: true } };
    saveMeta();
    schedulePush();
  }

  function schedulePush(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, pushDelay);
  }

  /** Pushes all dirty keys now. Safe to call repeatedly; runs one push at a time. */
  async function flush(): Promise<void> {
    if (pushing) return pushing;
    pushing = pushDirty().finally(() => {
      pushing = null;
    });
    return pushing;
  }

  async function pushDirty(): Promise<void> {
    const printers = readPrinters();
    const home = pickHomePrinter(printers, origin);
    for (const key of Object.keys(meta)) {
      const entry = meta[key];
      if (!entry?.dirty) continue;
      const route = routeKey(key, home);
      const printer = route && printers.find((p) => p.id === route.printerId);
      if (!route || !printer) continue; // printer unknown now: keep dirty for later

      // Read the remote revision first so that we never go below it.
      const remote = await readItem(printer, route.remoteKey);
      if (remote === undefined) continue; // unreachable: try again on the next push
      const remoteRev = isEnvelope(remote) ? remote.rev : 0;
      const raw = inner.getItem(key);
      const parsed = parseJson(raw);
      const rev = Math.max(remoteRev, entry.rev) + 1;
      const envelope: RemoteEnvelope = {
        app: 'tessera',
        kind: 'settings',
        schema: 2,
        key,
        rev,
        updatedAt: now(),
        writer: writer(),
        data: raw === null || parsed === undefined ? null : toRemoteValue(key, parsed),
      };
      if (await writeItem(printer, route.remoteKey, envelope)) {
        // Re-check: the key may have changed while the request was in flight.
        const still = meta[key];
        meta = { ...meta, [key]: { rev, updatedAt: envelope.updatedAt, dirty: still?.updatedAt !== entry.updatedAt } };
        saveMeta();
      }
    }
    if (Object.values(meta).some((m) => m.dirty)) schedulePush();
  }

  // ----- pull -----------------------------------------------------------

  /**
   * Fetches the DB copies and applies the ones newer than ours. Local keys that
   * exist but were never mirrored are queued for a push (this is the migration).
   *
   * @param timeoutMs give up on slow printers after this long (boot must not hang)
   */
  async function pull(timeoutMs = 1500): Promise<PullResult> {
    const printers = readPrinters();
    if (printers.length === 0) return { changed: false, keys: [], noPrinters: true };
    const home = pickHomePrinter(printers, origin);

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const abortTimer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const changedKeys: string[] = [];
    const seen = new Set<string>();

    try {
      const spaces = await Promise.all(
        printers.map(async (p) => ({ p, space: await readNamespace(p, ctrl?.signal) })),
      );
      for (const { p, space } of spaces) {
        if (!space) continue; // unreachable: leave its keys alone
        for (const [encoded, value] of Object.entries(space)) {
          if (!isEnvelope(value)) continue; // not ours
          const localKey = localKeyFor(decodeRemoteKey(encoded), p.id, home);
          if (!localKey) continue;
          seen.add(localKey);
          const entry = meta[localKey];
          if (entry?.dirty) continue; // our change is pending and will win by rev
          if (entry && value.rev <= entry.rev) continue; // we are up to date
          const local = parseJson(inner.getItem(localKey));
          if (value.data === null) {
            inner.removeItem(localKey);
          } else {
            inner.setItem(localKey, JSON.stringify(fromRemoteValue(localKey, value.data, local)));
          }
          meta = { ...meta, [localKey]: { rev: value.rev, updatedAt: value.updatedAt } };
          changedKeys.push(localKey);
        }
      }

      // Migration: local keys the DB has never seen are published.
      const reachable = new Set(spaces.filter((s) => s.space).map((s) => s.p.id));
      for (let i = 0; i < inner.length; i += 1) {
        const key = inner.key(i);
        if (!key || seen.has(key) || meta[key]) continue;
        const route = routeKey(key, home);
        if (route && reachable.has(route.printerId)) {
          meta = { ...meta, [key]: { rev: 0, updatedAt: now(), dirty: true } };
        }
      }
      saveMeta();
      if (Object.values(meta).some((m) => m.dirty)) schedulePush();
    } finally {
      if (abortTimer !== null) clearTimeout(abortTimer);
    }
    return { changed: changedKeys.length > 0, keys: changedKeys, noPrinters: false };
  }

  /** Pull on window focus, at most once per {@link FOCUS_PULL_MIN_MS}. */
  async function pullOnFocus(): Promise<PullResult> {
    if (now() - lastFocusPull < FOCUS_PULL_MIN_MS) return { changed: false, keys: [], noPrinters: false };
    lastFocusPull = now();
    // Pending local edits go out first so they are not mistaken for a stale copy.
    await flush();
    return pull();
  }

  /** Pushes pending edits, then pulls; for moments the user expects fresh data (printer switch). */
  async function pullNow(): Promise<PullResult> {
    await flush();
    return pull();
  }

  /** True while local edits wait for a push (a reload would lose them). */
  function hasPending(): boolean {
    return timer !== null || pushing !== null || Object.values(meta).some((m) => m.dirty);
  }

  /** A `StorageLike` that reports writes of mirrored keys to this mirror. */
  const storage: StorageLike = {
    get length() {
      return inner.length;
    },
    key: (i) => inner.key(i),
    getItem: (k) => inner.getItem(k),
    setItem(k, v) {
      inner.setItem(k, v);
      markDirty(k);
    },
    removeItem(k) {
      inner.removeItem(k);
      markDirty(k);
    },
  };

  activeNotify = markDirty;

  return { storage, pull, pullNow, pullOnFocus, flush, hasPending, deviceId, markDirty };
}
