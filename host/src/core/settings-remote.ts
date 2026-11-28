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
 * Remote keys are *addressed* (schema 3): per-printer records carry the local
 * printer id (`settings:<printerId>`), device-wide records carry the device id
 * (`dev:<deviceId>:ui`). Two devices that add the same printer by hand get different
 * random ids and never share records; sharing happens only after an explicit
 * settings import, which copies the printer ids. The device id never leaves the
 * browser, so appearance (`ui`) is per device even then.
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

/**
 * Layout of the remote keys. 2 = id-less shared keys (any browser on the printer
 * saw them); 3 = addressed keys with the local printer id / device id.
 */
export const REMOTE_SCHEMA = 3;

/** Version of the `remote-meta` bookkeeping; bumps together with {@link REMOTE_SCHEMA}. */
const META_VERSION = 3;

const KEY_PREFIX = 'mpu:v2:';
const META_KEY = 'mpu:v2:remote-meta';
const DEVICE_ID_KEY = 'mpu:v2:deviceId';
const PRINTERS_KEY = 'mpu:v2:printers';
const GLOBAL_SETTINGS = 'settings:GLOBAL';
const GLOBAL_PLUGIN_PREFIX = 'plugin-settings:GLOBAL:';
const PLUGIN_PREFIX = 'plugin-settings:';
/** Remote prefix of device-wide records: `dev:<deviceId>:<local key without mpu:v2:>`. */
const DEVICE_PREFIX = 'dev:';

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
  /** See {@link REMOTE_SCHEMA}; only schema 2 is eligible for migration. */
  schema: number;
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
  /** A schema-2 entry that must be compared with the DB before republishing. */
  migrate?: boolean;
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

/** Routing inputs that differ per device: the home printer and this device's id. */
export interface RouteContext {
  homePrinterId: string | null;
  deviceId: string;
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
 * mirrored. Per-printer data goes to that printer's own DB under a key with the
 * local printer id; device-wide data goes to the home printer's DB under a key with
 * the device id. The ids are random per browser, so records of two browsers never
 * collide unless one of them imported the other's settings file.
 */
export function routeKey(localKey: string, ctx: RouteContext): KeyRoute | null {
  if (!localKey.startsWith(KEY_PREFIX)) return null;
  const rest = localKey.slice(KEY_PREFIX.length);

  if (rest === 'ui' || rest === 'plugins' || rest === 'editor-colors' || rest === 'custom-font' || rest === GLOBAL_SETTINGS) {
    return ctx.homePrinterId
      ? { printerId: ctx.homePrinterId, remoteKey: `${DEVICE_PREFIX}${ctx.deviceId}:${rest}` }
      : null;
  }
  if (rest.startsWith(GLOBAL_PLUGIN_PREFIX)) {
    return ctx.homePrinterId
      ? { printerId: ctx.homePrinterId, remoteKey: `${DEVICE_PREFIX}${ctx.deviceId}:${rest}` }
      : null;
  }
  if (rest.startsWith('settings:')) {
    const printerId = rest.slice('settings:'.length);
    return printerId ? { printerId, remoteKey: `settings:${printerId}` } : null;
  }
  if (rest.startsWith(PLUGIN_PREFIX)) {
    const tail = rest.slice(PLUGIN_PREFIX.length);
    const sep = tail.indexOf(':');
    if (sep <= 0 || sep === tail.length - 1) return null;
    // The remote key already carries the printer id: plugin-settings:<id>:<pluginId>.
    return { printerId: tail.slice(0, sep), remoteKey: rest };
  }
  return null;
}

/**
 * Inverse of {@link routeKey} for a schema-3 record found in a printer's DB.
 * Records of other printers and other devices are ignored; device records are only
 * accepted from the home printer's DB.
 */
export function localKeyFor(remoteKey: string, printerId: string, ctx: RouteContext): string | null {
  if (remoteKey.startsWith(DEVICE_PREFIX)) {
    if (printerId !== ctx.homePrinterId) return null;
    const rest = remoteKey.slice(DEVICE_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep <= 0 || sep === rest.length - 1) return null;
    if (rest.slice(0, sep) !== ctx.deviceId) return null;
    const name = rest.slice(sep + 1);
    if (
      name === 'ui' ||
      name === 'plugins' ||
      name === 'editor-colors' ||
      name === 'custom-font' ||
      name === GLOBAL_SETTINGS ||
      name.startsWith(GLOBAL_PLUGIN_PREFIX)
    ) {
      return `${KEY_PREFIX}${name}`;
    }
    return null;
  }
  if (remoteKey.startsWith('settings:')) {
    // Only this printer's own record, found in its own DB.
    const pid = remoteKey.slice('settings:'.length);
    return pid && pid === printerId ? `${KEY_PREFIX}settings:${pid}` : null;
  }
  if (remoteKey.startsWith(PLUGIN_PREFIX)) {
    const tail = remoteKey.slice(PLUGIN_PREFIX.length);
    const sep = tail.indexOf(':');
    if (sep <= 0 || sep === tail.length - 1) return null;
    if (tail.slice(0, sep) !== printerId) return null;
    return `${KEY_PREFIX}${remoteKey}`;
  }
  return null;
}

/**
 * Maps a schema-2 remote key (the id-less shared layout) to its local key, for the
 * one-time adoption of records written before the schema-3 migration.
 */
function legacyLocalKeyFor(remoteKey: string, printerId: string, homePrinterId: string | null): string | null {
  if (remoteKey === 'settings') return `${KEY_PREFIX}settings:${printerId}`;
  if (remoteKey === GLOBAL_SETTINGS || remoteKey.startsWith(GLOBAL_PLUGIN_PREFIX)) {
    return printerId === homePrinterId ? `${KEY_PREFIX}${remoteKey}` : null;
  }
  // Legacy plugin keys had a single colon (plugin ids never contain one).
  if (remoteKey.startsWith(PLUGIN_PREFIX)) {
    const tail = remoteKey.slice(PLUGIN_PREFIX.length);
    if (tail.includes(':')) return null; // schema-3 key read by a downgraded record: not ours
    return `${KEY_PREFIX}${PLUGIN_PREFIX}${printerId}:${tail}`;
  }
  if (remoteKey === 'ui' || remoteKey === 'plugins' || remoteKey === 'editor-colors' || remoteKey === 'custom-font') {
    return printerId === homePrinterId ? `${KEY_PREFIX}${remoteKey}` : null;
  }
  return null;
}

/** Placeholder context for "is this key mirrored at all" checks (no real ids needed). */
const PROBE_CTX: RouteContext = { homePrinterId: 'probe', deviceId: 'probe' };

function isMirroredKey(localKey: string): boolean {
  return routeKey(localKey, PROBE_CTX) !== null;
}

/**
 * The printer that serves this page (same origin), else the first one. Device-wide
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

/** Receives local writes made behind the wrapper's back (see section-about import). */
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

  let meta: Record<string, MetaEntry>;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pushing: Promise<void> | null = null;
  let lastFocusPull = 0;
  /** Legacy records remain in Moonraker until their addressed replacements are saved. */
  const legacyDeletes = new Map<string, { printer: PrinterRef; remoteKey: string; rev: number }>();

  /**
   * Reads the bookkeeping, upgrading the legacy bare map to the versioned form.
   * Legacy entries keep their rev and real pending edits. Clean entries wait for a
   * namespace read, so a newer schema-2 copy can win before republishing.
   */
  function loadMeta(): void {
    const v = parseJson(inner.getItem(META_KEY));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      if (rec.v === META_VERSION && rec.entries && typeof rec.entries === 'object' && !Array.isArray(rec.entries)) {
        meta = rec.entries as Record<string, MetaEntry>;
        return;
      }
      // Schema-2 meta was the bare entries map. An unknown future version is reset:
      // its lineage cannot be trusted, and a full republish is the safe fallback.
      const legacy = (rec.v === undefined ? rec : {}) as Record<string, MetaEntry>;
      meta = {};
      for (const [k, e] of Object.entries(legacy)) {
        if (!e || typeof e.rev !== 'number' || !isMirroredKey(k)) continue;
        meta[k] = {
          rev: e.rev,
          updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : now(),
          dirty: e.dirty === true,
          migrate: true,
        };
      }
      saveMeta();
      return;
    }
    meta = {};
  }

  function saveMeta(): void {
    try {
      inner.setItem(META_KEY, JSON.stringify({ v: META_VERSION, entries: meta }));
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

  /** Removes an adopted legacy record; failures are retried by the next pull. */
  async function deleteItem(p: PrinterRef, remoteKey: string): Promise<boolean> {
    try {
      const res = await doFetch(
        `${baseUrl(p)}/server/database/item?namespace=${REMOTE_NAMESPACE}&key=${encodeURIComponent(encodeRemoteKey(remoteKey))}`,
        { method: 'DELETE', headers: authHeaders(p.id) },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  // ----- local change tracking ------------------------------------------

  /** Called for every write of a mirrored key; schedules a push. */
  function markDirty(key: string): void {
    if (!isMirroredKey(key)) return;
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
    const ctx: RouteContext = { homePrinterId: home, deviceId: deviceId() };
    for (const key of Object.keys(meta)) {
      const entry = meta[key];
      if (!entry?.dirty) continue;
      const route = routeKey(key, ctx);
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
        schema: REMOTE_SCHEMA,
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
        // The old shared key is the fallback until its addressed copy is durable.
        const legacy = legacyDeletes.get(key);
        if (legacy && await deleteItem(legacy.printer, legacy.remoteKey)) legacyDeletes.delete(key);
      }
    }
    if (Object.values(meta).some((m) => m.dirty)) schedulePush();
  }

  // ----- pull -----------------------------------------------------------

  /**
   * Fetches the DB copies and applies the ones newer than ours. Local keys that
   * exist but were never mirrored are queued for a push (this is the migration).
   * Schema-2 records are adopted under the same revision rules; pushDirty deletes
   * them only after the addressed replacement has been saved.
   *
   * @param timeoutMs give up on slow printers after this long (boot must not hang)
   */
  async function pull(timeoutMs = 1500): Promise<PullResult> {
    const printers = readPrinters();
    if (printers.length === 0) return { changed: false, keys: [], noPrinters: true };
    const home = pickHomePrinter(printers, origin);
    const ctx: RouteContext = { homePrinterId: home, deviceId: deviceId() };

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
          const remoteKey = decodeRemoteKey(encoded);
          // Unknown future layouts must not be mistaken for schema-2 records.
          if (value.schema !== 2 && value.schema !== REMOTE_SCHEMA) continue;
          const legacy = value.schema === 2;
          const localKey = legacy
            ? legacyLocalKeyFor(remoteKey, p.id, home)
            : localKeyFor(remoteKey, p.id, ctx);
          if (!localKey) continue;
          seen.add(localKey);
          const entry = meta[localKey];
          // A pending local edit or an up-to-date copy wins over the remote record.
          const skip = Boolean(entry?.dirty) || (entry !== undefined && value.rev <= entry.rev);
          if (!skip) {
            const local = parseJson(inner.getItem(localKey));
            if (value.data === null) {
              inner.removeItem(localKey);
            } else {
              inner.setItem(localKey, JSON.stringify(fromRemoteValue(localKey, value.data, local)));
            }
            meta = { ...meta, [localKey]: { rev: value.rev, updatedAt: value.updatedAt } };
            changedKeys.push(localKey);
          }
          if (legacy) {
            // Defer dirty marking until every record is compared: a schema-3
            // copy in this namespace may already have a newer revision.
            legacyDeletes.set(localKey, { printer: p, remoteKey, rev: value.rev });
          }
        }
      }

      // A clean schema-2 meta entry may be republished only after its printer's
      // namespace was read; offline printers keep their old revision for retry.
      const reachable = new Set(spaces.filter((s) => s.space).map((s) => s.p.id));
      for (const [key, entry] of Object.entries(meta)) {
        const route = routeKey(key, ctx);
        if (!route || !reachable.has(route.printerId)) continue;
        const legacy = legacyDeletes.get(key);
        if (!entry.migrate && !legacy) continue;
        meta = {
          ...meta,
          [key]: { ...entry, rev: Math.max(entry.rev, legacy?.rev ?? 0), dirty: true },
        };
      }

      // Migration: local keys the DB has never seen are published.
      for (let i = 0; i < inner.length; i += 1) {
        const key = inner.key(i);
        if (!key || seen.has(key) || meta[key]) continue;
        const route = routeKey(key, ctx);
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

  loadMeta();

  activeNotify = markDirty;

  return { storage, pull, pullNow, pullOnFocus, flush, hasPending, deviceId, markDirty };
}
