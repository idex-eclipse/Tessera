/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  ConnectionStatus,
  MoonrakerEventParams,
  MoonrakerProxyHandle,
} from '../../../plugin-sdk/src/types';

/**
 * Minimal WebSocket-like contract.
 *
 * This lets us inject a mock WebSocket in tests and use
 * the real browser WebSocket in production.
 */
export interface WebSocketLike {
  readyState: number;

  send(data: string): void;
  close(code?: number, reason?: string): void;

  onopen: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface CacheRule {
  match: string | RegExp | ((method: string) => boolean);
  ttl: number;
  invalidateOn?: string[];
}

export interface MoonrakerProxyDeps {
  WebSocket?: WebSocketFactory;
  baseReconnectDelay?: number;
  maxReconnectDelay?: number;

  /**
   * Clock injection for deterministic tests.
   */
  now?: () => number;

  /**
   * Custom TTL cache rules.
   * If omitted, DEFAULT_CACHE_RULES are used.
   */
  cacheRules?: CacheRule[];
}

export interface MoonrakerProxy {
  readonly handle: MoonrakerProxyHandle;

  readonly disposed: boolean;
  readonly printerUrl: string;
  readonly wsUrl: string;
  readonly httpBaseUrl: string;
  readonly authRequired: boolean;

  setAuthToken(token: string | null): void;
  onAuthRequired(callback: () => void): () => void;

  dispose(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface CreateProxyInternalOptions {
  onDispose?: () => void;
}

type SubscriptionCallback = (delta: any) => void;

interface SubscriptionRecord {
  id: number;
  objects: Record<string, string[]>;
  callback: SubscriptionCallback;
  immediate: boolean;
  needsInitial: boolean;
}

interface TtlCacheEntry {
  value: unknown;
  expiresAt: number;
  invalidateOn: Set<string>;
}

interface PollRecord {
  id: number;
  method: string;
  params: unknown;
  interval: number;
}

interface PollScheduleEntry {
  method: string;
  params: unknown;
  interval: number;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
}

export class MoonrakerRequestError extends Error {
  readonly code: unknown;
  readonly data: unknown;

  constructor(message: string, code?: unknown, data?: unknown) {
    super(message);
    this.name = 'MoonrakerRequestError';
    this.code = code;
    this.data = data;
  }
}

const pool = new Map<string, MoonrakerProxy>();

const SNAPSHOT_REQUEST_METHODS = new Set(['server.info', 'printer.info']);

const DEFAULT_CACHE_RULES: CacheRule[] = [
  {
    match: 'server.files.list',
    ttl: 10_000,
    invalidateOn: ['notify_filelist_changed'],
  },
  {
    match: 'server.files.get_directory',
    ttl: 10_000,
    invalidateOn: ['notify_filelist_changed'],
  },
  {
    match: 'server.files.metadata',
    ttl: 10_000,
    invalidateOn: ['notify_filelist_changed'],
  },
  {
    match: 'server.history.list',
    ttl: 10_000,
    invalidateOn: ['notify_history_changed'],
  },
  {
    match: /^printer\.configfile\./,
    ttl: 30_000,
    invalidateOn: ['notify_config_changed'],
  },
];

/**
 * Methods that must never be cached.
 */
const NON_CACHEABLE_METHODS = new Set<string>([
  'printer.gcode.script',
  'printer.emergency_stop',
  'printer.restart',
  'printer.firmware_restart',
  'printer.objects.subscribe',
  'printer.objects.unsubscribe',
  'server.files.upload',
  'server.files.delete_file',
  'server.files.move',
  'server.files.copy',
  'server.files.post_directory',
  'server.files.delete_directory',
]);

const NON_CACHEABLE_PATTERNS: RegExp[] = [
  /^server\.webcams\./,
  /^server\.files\.(upload|delete|move|copy|post)/,
];

/**
 * Pool accessor.
 *
 * One ProxyInstance per normalized printer URL.
 * Switching active printer MUST NOT destroy previous proxy.
 */
export function getMoonrakerProxy(
  printerUrl: string,
  deps: MoonrakerProxyDeps = {},
): MoonrakerProxy {
  const key = normalizeOrigin(printerUrl);

  const existing = pool.get(key);
  if (existing && !existing.disposed) {
    return existing;
  }

  const proxy = createMoonrakerProxy(printerUrl, deps, {
    onDispose: () => {
      if (pool.get(key) === proxy) {
        pool.delete(key);
      }
    },
  });

  pool.set(key, proxy);
  return proxy;
}

/**
 * Test/helper utility.
 * Disposes and forgets all proxy instances.
 */
export function clearMoonrakerProxyPool(): void {
  const proxies = Array.from(pool.values());
  pool.clear();

  for (const proxy of proxies) {
    proxy.dispose();
  }
}

/**
 * Creates a new proxy instance.
 *
 * In production code, prefer getMoonrakerProxy() unless you explicitly
 * need an isolated instance (mostly tests).
 */
export function createMoonrakerProxy(
  printerUrl: string,
  deps: MoonrakerProxyDeps = {},
  internal: CreateProxyInternalOptions = {},
): MoonrakerProxy {
  const sourceUrl = printerUrl.trim();

  const normalizedPrinterUrl = normalizeOrigin(sourceUrl);
  const wsUrl = toWsUrl(sourceUrl);
  const httpBaseUrl = toHttpBaseUrl(sourceUrl);

  const webSocketFactory = deps.WebSocket ?? defaultWebSocketFactory;
  const baseReconnectDelay = deps.baseReconnectDelay ?? 1000;
  const maxReconnectDelay = deps.maxReconnectDelay ?? 30_000;
  const now = deps.now ?? (() => Date.now());
  const cacheRules = deps.cacheRules ?? DEFAULT_CACHE_RULES;
  const ttlCache = new Map<string, TtlCacheEntry>();

  let disposed = false;

  let ws: WebSocketLike | null = null;
  let readyState: ConnectionStatus = 'connecting';

  let nextRequestId = 1;
  let nextSubscriptionId = 1;

  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  let authToken: string | null = null;
  let authRequired = false;
  const authListeners = new Set<() => void>();

  const pendingRequests = new Map<number, PendingRequest>();

  const connectionListeners = new Set<(status: ConnectionStatus) => void>();
  const readyListeners = new Set<() => void>();
  const notifyListeners = new Map<string, Set<(params: MoonrakerEventParams) => void>>();

  /**
   * Status snapshot cache.
   * Lives only while WS is alive.
   */
  let statusSnapshot: Record<string, Record<string, unknown>> = {};

  /**
   * Snapshot cache for server.info / printer.info.
   * Lives only while WS is alive.
   */
  const requestSnapshotCache = new Map<string, unknown>();

  /**
   * Active plugin subscriptions.
   */
  const subscribers = new Map<number, SubscriptionRecord>();

  /**
   * Desired active objects/fields across all subscribers.
   * '*' means wildcard (all fields).
   */
  let activeFields = new Map<string, Set<string>>();
    
  /**
   * Poll-on-demand: плагины декларируют потребность в свежести кэша;
   * прокси поллит (min-интервал по method+params, refcounted) и освежает
   * snapshot/TTL-кэши. request() читает их прозрачно.
   */
  let nextPollId = 1;
  const pollRecords = new Map<number, PollRecord>();
  const pollSchedule = new Map<string, PollScheduleEntry>();

  connect();

  async function connect(): Promise<void> {
    if (disposed) {
      return;
    }

    const probe = await probeAuthStatus();
    if (probe === 'auth-required') {
      flagAuthRequired();
      scheduleReconnect(); // повторная попытка через backoff (после логина)
      return;
    }

    if (ws) {
      detachSocket(ws);
      try {
        ws.close();
      } catch {
        // Ignore close errors in transport layer.
      }
      ws = null;
    }

    setReadyState('connecting');

    let socket: WebSocketLike;

    try {
      const url = authToken
        ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`
        : wsUrl;
      socket = webSocketFactory(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws = socket;

    socket.onopen = () => {
      if (disposed || ws !== socket) {
        return;
      }

      reconnectAttempts = 0;
      setReadyState('open');
      emitReady();
      activateSubscriptions();

      // немедленный тик всех активных поллов после открытия сокета
      for (const key of Array.from(pollSchedule.keys())) {
        void pollTick(key);
      }
    };

    socket.onclose = (event) => {
      if (disposed || ws !== socket) {
        return;
      }

      const code = (event as { code?: number } | null)?.code;
      if (code === 4001 || code === 4003) {
        flagAuthRequired();
      }

      handleClosed();
    };

    socket.onerror = () => {
      if (disposed || ws !== socket) {
        return;
      }

      // Browser WebSocket usually follows error with close.
      // We intentionally do not reject pending requests here;
      // close handling is the single source of connection loss.
    };

    socket.onmessage = (event) => {
      if (disposed || ws !== socket) {
        return;
      }

      handleMessage(event.data);
    };
  }

    /**
   * HTTP pre-probe auth-статуса.
   * Moonraker в auth-режиме (без trusted IP) отказывает WS-соединению с 403,
   * поэтому до открытия сокета проверяем auth через лёгкий HTTP-запрос.
   * Если токен есть — шлём Authorization, иначе получим 401/403 и включим AuthOverlay.
   */
  async function probeAuthStatus(): Promise<'ok' | 'auth-required'> {
    //console.log('[proxy] probeAuthStatus start, authToken:', authToken ? '***' : null);
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    try {
      // /access/info — самый лёгкий endpoint; может быть 404 в старых версиях,
      // тогда fallback на /server/info. Оба от Moonraker, оба лёгкие.
      let res = await fetch(`${httpBaseUrl}/access/info`, { headers, cache: 'no-store' });
      if (res.status === 404) {
        res = await fetch(`${httpBaseUrl}/server/info`, { headers, cache: 'no-store' });
      }

      if (res.status === 401 || res.status === 403) {
        //console.log('[proxy] probe → auth-required');
        return 'auth-required';
      }
      //console.log('[proxy] probe → ok');
      return 'ok';
    } catch (e){
      // сетевая ошибка — пусть разбирается сам WS connect
      //console.log('[proxy] probe network error:', e);
      return 'ok';
    }
  }

  function handleClosed(): void {
    statusSnapshot = {};
    requestSnapshotCache.clear();

    for (const record of subscribers.values()) {
      if (record.immediate) {
        record.needsInitial = true;
      }
    }

    rejectPendingRequests(new Error('Moonraker connection closed'));
    setReadyState('closed');
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (disposed) {
      return;
    }

    if (reconnectTimer !== null) {
      return;
    }

    const delay = Math.min(
      baseReconnectDelay * 2 ** reconnectAttempts,
      maxReconnectDelay,
    );

    reconnectAttempts += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function setReadyState(next: ConnectionStatus): void {
    if (disposed) {
      readyState = next;
      return;
    }

    if (readyState === next) {
      return;
    }

    readyState = next;

    for (const listener of Array.from(connectionListeners)) {
      safeCall(listener, next);
    }
  }

  function emitReady(): void {
    for (const listener of Array.from(readyListeners)) {
      safeCall(listener);
    }
  }

    function isAuthError(error: { message?: unknown; code?: unknown }): boolean {
    if (error.code === 401) return true;
    const msg = typeof error.message === 'string' ? error.message : '';
    return /unauthorized|authentication/i.test(msg);
  }

  function flagAuthRequired(): void {
    //console.log('[proxy] flagAuthRequired called, authRequired was:', authRequired, 'listeners:', authListeners.size);
    if (authRequired) return;
    authRequired = true;
    for (const listener of Array.from(authListeners)) {
      //console.log('[proxy] calling auth listener');
      safeCall(listener);
    }
  }

  /** Host-only: установить/снять токен → реконнект WS с ?token=. */
  function setAuthToken(token: string | null): void {
    if (authToken === token) return;
    authToken = token;
    authRequired = false;
    connect();
  }

  function onAuthRequired(callback: () => void): () => void {
    authListeners.add(callback);
    return () => {
      authListeners.delete(callback);
    };
  }

  /**
   * Raw JSON-RPC без кэшей и GuardAgent. Используется ТОЛЬКО для
   * внутренних refresh-чтений прокси (pollTick).
   */
  function sendRaw<T = unknown>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (disposed || readyState !== 'open' || !ws) {
        reject(new Error('Moonraker connection is not open'));
        return;
      }
      const id = nextRequestId++;
      const payload: Record<string, unknown> = { jsonrpc: '2.0', method, id };
      if (params !== undefined) payload.params = params;
      pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      try {
        ws!.send(JSON.stringify(payload));
      } catch (error) {
        pendingRequests.delete(id);
        reject(error);
      }
    });
  }

function request<T = unknown>(method: string, params?: unknown): Promise<T> {
  if (disposed) {
    return Promise.reject(new Error('Moonraker proxy disposed'));
  }

  /**
   * Snapshot cache for server.info / printer.info.
   * This cache lives only while WS is alive.
   */
  const snapshotRequest = SNAPSHOT_REQUEST_METHODS.has(method);
  const snapshotKey = snapshotRequest
    ? createSnapshotRequestKey(method, params)
    : null;

  if (snapshotRequest && snapshotKey && requestSnapshotCache.has(snapshotKey)) {
    return Promise.resolve(requestSnapshotCache.get(snapshotKey) as T);
  }

  /**
   * TTL cache for safe read requests.
   *
   * TTL cache may survive a short connection drop.
   * It is limited by time and notify invalidation.
   */
  const cacheRule = findCacheRule(cacheRules, method);
  const cacheKey = isNonCacheableMethod(method)
    ? null
    : createCacheKey(method, params);

  // Читаем из TTL-кэша независимо от того, кто его наполнил:
  // cacheRule или активный poll-on-demand.
  if (cacheKey) {
    const entry = ttlCache.get(cacheKey);
    if (entry) {
      if (entry.expiresAt > now()) {
        return Promise.resolve(entry.value as T);
      }
      ttlCache.delete(cacheKey);
    }
  }

  if (readyState !== 'open' || !ws) {
    return Promise.reject(new Error('Moonraker connection is not open'));
  }

  const id = nextRequestId++;

  const payload: Record<string, unknown> = {
    jsonrpc: '2.0',
    method,
    id,
  };

  if (params !== undefined) {
    payload.params = params;
  }

  const promise = new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    try {
      ws!.send(JSON.stringify(payload));
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
    }
  });

  if (snapshotRequest && snapshotKey) {
    return promise.then((result) => {
      requestSnapshotCache.set(snapshotKey, result);
      return result;
    });
  }

  // Записываем в TTL-кэш если есть cacheRule ИЛИ активен poll-schedule.
  // TTL = max(rule.ttl, interval*2) чтобы не было "пропусков" при поллинге.
  if (cacheKey) {
    const pollEntry = pollSchedule.get(cacheKey);
    if (cacheRule || pollEntry) {
      const baseTtl = cacheRule ? cacheRule.ttl : 0;
      const pollTtl = pollEntry ? pollEntry.interval * 2 : 0;
      const ttl = Math.max(baseTtl, pollTtl);
      const invalidateOn = new Set(cacheRule?.invalidateOn ?? []);
      return promise.then((result) => {
        ttlCache.set(cacheKey, {
          value: result,
          expiresAt: now() + ttl,
          invalidateOn,
        });
        return result;
      });
    }
  }

  return promise;
}

  function pollKeyFor(method: string, params: unknown): string {
    return SNAPSHOT_REQUEST_METHODS.has(method)
      ? createSnapshotRequestKey(method, params)
      : createCacheKey(method, params);
  }

  async function pollTick(key: string): Promise<void> {
    const entry = pollSchedule.get(key);
    if (!entry || entry.inFlight) return;
    if (disposed || readyState !== 'open' || !ws) return;

    entry.inFlight = true;
    try {
      const result = await sendRaw(entry.method, entry.params);
      // Обновляем тот же кэш, что читает request(): snapshot или TTL.
      if (SNAPSHOT_REQUEST_METHODS.has(entry.method)) {
        requestSnapshotCache.set(key, result);
      } else {
        const rule = findCacheRule(cacheRules, entry.method);
        const baseTtl = rule ? rule.ttl : 0;
        const ttl = Math.max(baseTtl, entry.interval * 2);
        ttlCache.set(key, {
          value: result,
          expiresAt: now() + ttl,
          invalidateOn: new Set(rule?.invalidateOn ?? []),
        });
      }
    } catch {
      // ошибки поллинга молчаливые: следующий тик повторит;
      // потеря соединения обрабатывается reconnect-механизмой прокси
    } finally {
      entry.inFlight = false;
    }
  }

  function syncPollSchedule(key: string): void {
    // min-интервал по всем регистрациям с данным ключом (refcount)
    let best: { method: string; params: unknown; interval: number } | null = null;
    for (const rec of pollRecords.values()) {
      if (pollKeyFor(rec.method, rec.params) !== key) continue;
      if (!best || rec.interval < best.interval) best = rec;
    }

    const existing = pollSchedule.get(key);

    if (!best) {
      if (existing?.timer !== null && existing) clearInterval(existing.timer!);
      pollSchedule.delete(key);
      return;
    }

    if (existing) {
      existing.method = best.method;
      existing.params = best.params;
      if (existing.interval !== best.interval) {
        if (existing.timer !== null) clearInterval(existing.timer);
        existing.timer = setInterval(() => void pollTick(key), best.interval);
        existing.interval = best.interval;
      }
      return;
    }

    pollSchedule.set(key, {
      method: best.method,
      params: best.params,
      interval: best.interval,
      timer: setInterval(() => void pollTick(key), best.interval),
      inFlight: false,
    });
    void pollTick(key); // первый тик сразу
  }

  function poll(method: string, params: unknown, intervalMs: number): () => void {
    if (disposed) return () => {};

    if (isNonCacheableMethod(method)) {
      console.warn(
        `[moonraker-proxy] poll() refused for non-cacheable method: ${method}`,
      );
      return () => {};
    }

    const id = nextPollId++;
    pollRecords.set(id, {
      id,
      method,
      params,
      interval: Math.max(250, Math.floor(intervalMs)),
    });
    syncPollSchedule(pollKeyFor(method, params));

    return () => {
      if (!pollRecords.delete(id)) return;
      syncPollSchedule(pollKeyFor(method, params));
    };
  }

  function handleMessage(rawData: string): void {
    let message: unknown;

    try {
      message = JSON.parse(rawData);
    } catch {
      // Malformed messages must not kill the proxy.
      return;
    }

    if (!message || typeof message !== 'object') {
      return;
    }

    const rpc = message as Record<string, unknown>;

    if (typeof rpc.id === 'number' && pendingRequests.has(rpc.id)) {
      const pending = pendingRequests.get(rpc.id);
      pendingRequests.delete(rpc.id);

      if (!pending) {
        return;
      }

      if (rpc.error && typeof rpc.error === 'object') {
        const error = rpc.error as {
          message?: unknown;
          code?: unknown;
          data?: unknown;
        };

        // 401/Unauthorized от Moonraker → сигнал хосту показать AuthOverlay
        if (isAuthError(error)) {
          flagAuthRequired();
        }

        const errorMessage =
          typeof error.message === 'string'
            ? error.message
            : 'Moonraker request failed';

        pending.reject(
          new MoonrakerRequestError(errorMessage, error.code, error.data),
        );
        return;
      }

      pending.resolve(rpc.result);
      return;
    }

    if (typeof rpc.method === 'string') {
      dispatchNotify(rpc.method, rpc.params);
    }
  }

  function invalidateTtlCachesForEvent(event: string): void {
    if (ttlCache.size === 0) {
      return;
    }

    for (const [key, entry] of Array.from(ttlCache.entries())) {
      if (entry.invalidateOn.has(event)) {
        ttlCache.delete(key);
      }
    }
  }

  function dispatchNotify(event: string, params: MoonrakerEventParams): void {
    if (event === 'notify_status_update') {
      handleStatusUpdate(params);
    }

    /**
     * Klipper lifecycle changes make server.info / printer.info snapshots stale.
     */
    if (event.startsWith('notify_klippy_')) {
      requestSnapshotCache.delete('server.info');
      requestSnapshotCache.delete('printer.info');
    }

    invalidateTtlCachesForEvent(event);

    const listeners = notifyListeners.get(event);
    if (!listeners) {
      return;
    }

    for (const listener of Array.from(listeners)) {
      safeCall(listener, params);
    }
  }

  function handleStatusUpdate(params: MoonrakerEventParams): void {
    const delta = Array.isArray(params) ? params[0] : params;

    if (!delta || typeof delta !== 'object') {
      return;
    }

    mergeSnapshot(delta as Record<string, unknown>);

    for (const record of Array.from(subscribers.values())) {
      const filtered = filterDelta(delta as Record<string, any>, record.objects);

      if (Object.keys(filtered).length > 0) {
        safeCall(record.callback, filtered);
      }
    }
  }

  function mergeSnapshot(delta: Record<string, unknown>): void {
    for (const [objectName, fields] of Object.entries(delta)) {
      if (!fields || typeof fields !== 'object') {
        continue;
      }

      statusSnapshot[objectName] = {
        ...statusSnapshot[objectName],
        ...(fields as Record<string, unknown>),
      };
    }
  }

  function deliverInitialToSubscribers(): void {
    for (const record of subscribers.values()) {
      if (!record.needsInitial) {
        continue;
      }

      const snapshot = filterDelta(statusSnapshot, record.objects);

      if (Object.keys(snapshot).length > 0) {
        safeCall(record.callback, snapshot);
        record.needsInitial = false;
      }
    }
  }

  function activateSubscriptions(): void {
    if (disposed || readyState !== 'open') {
      return;
    }

    if (subscribers.size === 0) {
      return;
    }

    const objects = objectsFromActiveFields(activeFields);

    if (Object.keys(objects).length > 0) {
      sendSubscribe(objects);
    }
  }

  function sendSubscribe(objects: Record<string, string[]>): void {
    if (disposed || readyState !== 'open') {
      return;
    }

    const wireObjects = toWireObjects(objects);

    if (Object.keys(wireObjects).length === 0) {
      return;
    }

    request('printer.objects.subscribe', { objects: wireObjects })
      .then((result: any) => {
        const status = result?.status;

        if (status && typeof status === 'object') {
          mergeSnapshot(status as Record<string, unknown>);
        }

        deliverInitialToSubscribers();
      })
      .catch(() => {
        // Subscription request can fail on connection loss.
        // Desired state remains; reconnect will retry.
      });
  }

  function sendUnsubscribe(objects: Record<string, string[]>): void {
    if (disposed || readyState !== 'open') {
      return;
    }

    const wireObjects = toWireObjects(objects);

    if (Object.keys(wireObjects).length === 0) {
      return;
    }

    request('printer.objects.unsubscribe', { objects: wireObjects }).catch(
      () => {
        // Ignore unsubscribe transport errors.
        // State is already locally consistent.
      },
    );
  }

  function subscribe(
    objects: Record<string, string[]>,
    callback: SubscriptionCallback,
    options?: { immediate?: boolean },
  ): () => void {
    if (disposed) {
      return () => {
        // noop
      };
    }

    const normalized = normalizeSubscriptionObjects(objects);
    const immediate = options?.immediate !== false;

    const id = nextSubscriptionId++;

    const record: SubscriptionRecord = {
      id,
      objects: normalized,
      callback,
      immediate,
      needsInitial: immediate,
    };

    const oldActive = cloneActiveFields(activeFields);

    subscribers.set(id, record);

    const newActive = desiredFieldsFromSubscribers(subscribers);
    const added = diffAdded(oldActive, newActive);

    activeFields = newActive;

    if (readyState === 'open') {
      if (Object.keys(added).length > 0) {
        // Moonraker treats each printer.objects.subscribe as the COMPLETE
        // desired set (replace semantics). Sending only the added diff
        // would silently drop previously subscribed objects — late objects
        // like manual_probe/bed_mesh were never watched, which is why their
        // notify_status_update never arrived and everything lived on refresh().
        // Always send the full deduped union across all subscribers.
        sendSubscribe(objectsFromActiveFields(newActive));
      } else if (immediate) {
        queueMicrotask(() => {
          if (!subscribers.has(id) || !record.needsInitial) {
            return;
          }

          const snapshot = filterDelta(statusSnapshot, record.objects);

          if (Object.keys(snapshot).length > 0) {
            safeCall(record.callback, snapshot);
            record.needsInitial = false;
          }
        });
      }
    }

    return () => {
      unsubscribeById(id);
    };
  }

  function unsubscribeById(id: number): void {
    const record = subscribers.get(id);

    if (!record) {
      return;
    }

    const oldActive = cloneActiveFields(activeFields);

    subscribers.delete(id);

    const newActive = desiredFieldsFromSubscribers(subscribers);
    const removed = diffRemoved(oldActive, newActive);

    activeFields = newActive;

    if (readyState === 'open' && Object.keys(removed).length > 0) {
      sendUnsubscribe(removed);
    }
  }

  function onNotify(
    event: string,
    callback: (params: MoonrakerEventParams) => void,
  ): () => void {
    let listeners = notifyListeners.get(event);

    if (!listeners) {
      listeners = new Set();
      notifyListeners.set(event, listeners);
    }

    listeners.add(callback);

    return () => {
      if (!listeners) {
        return;
      }

      listeners.delete(callback);

      if (listeners.size === 0) {
        notifyListeners.delete(event);
      }
    };
  }

  function onReady(callback: () => void): () => void {
    readyListeners.add(callback);

    if (readyState === 'open' && !disposed) {
      queueMicrotask(() => {
        if (readyListeners.has(callback) && readyState === 'open') {
          safeCall(callback);
        }
      });
    }

    return () => {
      readyListeners.delete(callback);
    };
  }

  function onConnectionStatusChange(
    callback: (status: ConnectionStatus) => void,
  ): () => void {
    connectionListeners.add(callback);

    return () => {
      connectionListeners.delete(callback);
    };
  }

  function rejectPendingRequests(error: Error): void {
    for (const pending of Array.from(pendingRequests.values())) {
      pending.reject(error);
    }

    pendingRequests.clear();
  }

  function detachSocket(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;

    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    rejectPendingRequests(new Error('Moonraker proxy disposed'));

    connectionListeners.clear();
    readyListeners.clear();
    notifyListeners.clear();

    subscribers.clear();
    activeFields.clear();

    statusSnapshot = {};
    requestSnapshotCache.clear();
    ttlCache.clear();

    if (ws) {
      detachSocket(ws);

      try {
        ws.close();
      } catch {
        // Ignore close errors during dispose.
      }

      ws = null;
    }

    for (const entry of pollSchedule.values()) {
      if (entry.timer !== null) clearInterval(entry.timer);
    }
    pollSchedule.clear();
    pollRecords.clear();

    readyState = 'closed';

    internal.onDispose?.();
  }

  const handle: MoonrakerProxyHandle = {
    request,
    subscribe,
    onNotify,
    poll,

    get httpBaseUrl() {
      return httpBaseUrl;
    },

    get readyState() {
      return readyState;
    },

    get authToken() {
      return authToken;
    },

    onReady,
    onConnectionStatusChange,
  };

  return {
    handle,

    get disposed() {
      return disposed;
    },

    setAuthToken,
    onAuthRequired,

    get authRequired() {
      return authRequired;
    },

    printerUrl: normalizedPrinterUrl,
    wsUrl,
    httpBaseUrl,

    dispose,
  };
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike })
    .WebSocket;

  if (!Ctor) {
    throw new Error('WebSocket is not available in this environment');
  }

  return new Ctor(url);
}

function normalizeOrigin(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');

  try {
    const url = new URL(trimmed);

    if (url.protocol === 'ws:') {
      return `http://${url.host}`;
    }

    if (url.protocol === 'wss:') {
      return `https://${url.host}`;
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.protocol}//${url.host}`;
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

function toWsUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');

  try {
    const url = new URL(trimmed);

    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return url.toString();
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

      if (url.pathname === '/' || url.pathname === '') {
        url.pathname = '/websocket';
      }

      return url.toString();
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

function toHttpBaseUrl(input: string): string {
  return normalizeOrigin(input).replace(/\/+$/, '');
}

function createSnapshotRequestKey(method: string, params?: unknown): string {
  if (params === undefined) {
    return method;
  }

  try {
    return `${method}:${JSON.stringify(params)}`;
  } catch {
    return method;
  }
}

function findCacheRule(
  rules: CacheRule[],
  method: string,
): CacheRule | undefined {
  if (isNonCacheableMethod(method)) {
    return undefined;
  }

  return rules.find((rule) => matchesCacheRule(rule.match, method));
}

function matchesCacheRule(
  match: CacheRule['match'],
  method: string,
): boolean {
  if (typeof match === 'string') {
    return method === match;
  }

  if (match instanceof RegExp) {
    return match.test(method);
  }

  return match(method);
}

function isNonCacheableMethod(method: string): boolean {
  if (NON_CACHEABLE_METHODS.has(method)) {
    return true;
  }

  return NON_CACHEABLE_PATTERNS.some((pattern) => pattern.test(method));
}

function createCacheKey(method: string, params?: unknown): string {
  if (params === undefined) {
    return method;
  }

  try {
    return `${method}:${JSON.stringify(canonicalize(params))}`;
  } catch {
    return method;
  }
}

/**
 * Produces a stable JSON-serializable representation.
 * Object key order does not affect cache key.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key]);
    }

    return result;
  }

  return value;
}

function normalizeSubscriptionObjects(
  objects: Record<string, string[]> | null | undefined,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  if (!objects || typeof objects !== 'object') {
    return result;
  }

  for (const [objectName, rawFields] of Object.entries(objects)) {
    if (!objectName) {
      continue;
    }

    const fields = Array.isArray(rawFields)
      ? rawFields.filter((field): field is string => typeof field === 'string')
      : [];

    const uniqueFields = Array.from(
      new Set(fields.length > 0 ? fields : ['*']),
    );

    if (uniqueFields.length > 0) {
      result[objectName] = uniqueFields;
    }
  }

  return result;
}

function cloneActiveFields(
  source: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const copy = new Map<string, Set<string>>();

  for (const [objectName, fields] of source.entries()) {
    copy.set(objectName, new Set(fields));
  }

  return copy;
}

function desiredFieldsFromSubscribers(
  subscribers: Map<number, SubscriptionRecord>,
): Map<string, Set<string>> {
  const desired = new Map<string, Set<string>>();

  for (const record of subscribers.values()) {
    for (const [objectName, fields] of Object.entries(record.objects)) {
      let set = desired.get(objectName);

      if (!set) {
        set = new Set();
        desired.set(objectName, set);
      }

      if (fields.includes('*')) {
        set.clear();
        set.add('*');
      } else if (!set.has('*')) {
        for (const field of fields) {
          set.add(field);
        }
      }
    }
  }

  return desired;
}

function diffAdded(
  oldActive: Map<string, Set<string>>,
  nextActive: Map<string, Set<string>>,
): Record<string, string[]> {
  const added: Record<string, string[]> = {};

  for (const [objectName, nextSet] of nextActive.entries()) {
    const oldSet = oldActive.get(objectName);

    if (!oldSet || oldSet.size === 0) {
      added[objectName] = setToFields(nextSet);
      continue;
    }

    if (oldSet.has('*')) {
      continue;
    }

    if (nextSet.has('*')) {
      added[objectName] = ['*'];
      continue;
    }

    const newFields = Array.from(nextSet).filter(
      (field) => !oldSet.has(field),
    );

    if (newFields.length > 0) {
      added[objectName] = newFields;
    }
  }

  return added;
}

function diffRemoved(
  oldActive: Map<string, Set<string>>,
  nextActive: Map<string, Set<string>>,
): Record<string, string[]> {
  const removed: Record<string, string[]> = {};

  for (const [objectName, oldSet] of oldActive.entries()) {
    const nextSet = nextActive.get(objectName);

    if (!nextSet || nextSet.size === 0) {
      removed[objectName] = ['*'];
      continue;
    }

    if (oldSet.has('*')) {
      // Downgrade from wildcard to explicit fields:
      // do not unsubscribe, filtering will prevent excess delivery.
      continue;
    }

    if (nextSet.has('*')) {
      continue;
    }

    const removedFields = Array.from(oldSet).filter(
      (field) => !nextSet.has(field),
    );

    if (removedFields.length > 0) {
      removed[objectName] = removedFields;
    }
  }

  return removed;
}

function setToFields(set: Set<string>): string[] {
  if (set.has('*')) {
    return ['*'];
  }

  return Array.from(set);
}

function objectsFromActiveFields(
  active: Map<string, Set<string>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const [objectName, fields] of active.entries()) {
    if (fields.size > 0) {
      result[objectName] = setToFields(fields);
    }
  }

  return result;
}

function toWireObjects(
  objects: Record<string, string[]>,
): Record<string, string[]> {
  const wire: Record<string, string[]> = {};

  for (const [objectName, fields] of Object.entries(objects)) {
    if (!fields.length) {
      continue;
    }

    wire[objectName] = fields.includes('*') ? [] : fields;
  }

  return wire;
}

function filterDelta(
  delta: Record<string, any>,
  objects: Record<string, string[]>,
): Record<string, any> {
  const result: Record<string, Record<string, unknown>> = {};

  if (!delta || typeof delta !== 'object') {
    return result;
  }

  for (const [objectName, wantedFields] of Object.entries(objects)) {
    const fields = delta[objectName];

    if (!fields || typeof fields !== 'object') {
      continue;
    }

    if (wantedFields.includes('*')) {
      const copy = { ...fields };

      if (Object.keys(copy).length > 0) {
        result[objectName] = copy;
      }

      continue;
    }

    const filtered: Record<string, unknown> = {};

    for (const field of wantedFields) {
      if (field in fields) {
        filtered[field] = fields[field];
      }
    }

    if (Object.keys(filtered).length > 0) {
      result[objectName] = filtered;
    }
  }

  return result;
}

function safeCall<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): void {
  try {
    fn(...args);
  } catch (error) {
    // Listener errors must not break proxy infrastructure.
    console.error('[moonraker-proxy] listener error', error);
  }
}