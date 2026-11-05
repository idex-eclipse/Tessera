import type { KlippyRequestOptions, KlippyStreamStatus } from '../../../plugin-sdk/src/types';
import type { WebSocketFactory, WebSocketLike } from './moonraker-proxy';

/**
 * Klippy-stream: bulk-потоки Klipper через raw-мост Moonraker `/klippysocket`.
 *
 * Обычный `/websocket` Moonraker такие данные не отдаёт: вебхук Klipper
 * (`load_cell/dump_force`) доставляет пакеты по `response_template`, и это
 * работает только на raw-мосте. Протокол моста: запрос без `jsonrpc`
 * `{id, method, params: {…, response_template: {key}}}`, ответ `{id, result|error}`,
 * далее сообщения `{key, params}`.
 *
 * У Klipper нет отписки: поток идёт, пока открыт сокет. Поэтому:
 * - сокет открывается лениво, с первой подписки (или запроса), один на прокси принтера;
 * - подписки с одинаковым method+params делят один поток Klipper (refcount);
 * - отмена подписки, после которой поток группы остаётся без слушателей, закрывает
 *   сокет, а оставшиеся группы подписываются заново на новом сокете; с последней
 *   отменой сокет закрыт и не переоткрывается.
 *
 * Помимо потоков мост умеет разовые запросы с ответом (`request`): `objects/list`,
 * `info` и т.п. Они идут по тому же сокету, а без подписок сокет закрывается
 * после короткой паузы простоя.
 *
 * Плагин сокетов не видит: он вызывает `handle.klippyStream(...)`, как `poll`.
 */

/**
 * Methods a plugin must never reach over the bridge: every one of them changes printer
 * state. The bridge is read-only by policy (`docs/en/moonraker-proxy.md`), so the rule is
 * a denylist of the Klipper core endpoints with side effects (`klippy/webhooks.py`,
 * `extras/pause_resume.py`); everything else is treated as a read.
 *
 * Third-party `extras` may register their own writing endpoints; this list cannot know
 * about them. Names are compared after `normalizeKlippyMethod`, so the entries are
 * lower-case.
 */
export const KLIPPY_BLOCKED_METHODS: ReadonlySet<string> = new Set([
  'emergency_stop',
  'register_remote_method',
  'gcode/script',
  'gcode/restart',
  'gcode/firmware_restart',
]);

/** Whole endpoint families that are blocked (matched by `<prefix>/`). */
const KLIPPY_BLOCKED_PREFIXES: readonly string[] = ['pause_resume/'];

/** One or two path segments, as every Klipper webhooks endpoint has. */
const METHOD_RE = /^[a-z0-9_]+(\/[a-z0-9_]+)?$/;

/** How long the socket stays open after the last pending request when nothing else needs it. */
const IDLE_CLOSE_MS = 2000;

/** Default time to wait for the answer of one request. */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Canonical form of a method name, or null when it is not a plausible endpoint name.
 * The caller must send THIS string, never the original: the blocklist is checked against
 * it, so a variant that normalizes into a blocked name (`Emergency_Stop`, a trailing
 * ETX, a fullwidth spelling) cannot slip past a check and still reach Klipper unchanged.
 */
export function normalizeKlippyMethod(method: unknown): string | null {
  if (typeof method !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- stripping control chars (incl. the 0x03 frame delimiter) is the point
  const name = method.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().toLowerCase();
  return METHOD_RE.test(name) ? name : null;
}

/** True for a normalized method that must not be sent over the bridge. */
export function isKlippyMethodBlocked(normalized: string): boolean {
  return (
    KLIPPY_BLOCKED_METHODS.has(normalized) || KLIPPY_BLOCKED_PREFIXES.some((p) => normalized.startsWith(p))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/** JSON with sorted object keys, so equal params always map to the same stream group. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Validated method and params of a bridge call, or the reason it is refused.
 * Params must be a plain object and must not carry their own `response_template`:
 * the stream owns that key (it routes the batches), and a request must stay one-shot.
 */
function checkCall(
  method: unknown,
  params: unknown,
): { ok: true; method: string; params: Record<string, unknown> } | { ok: false; reason: string } {
  const name = normalizeKlippyMethod(method);
  if (name === null) return { ok: false, reason: `malformed method: ${String(method)}` };
  if (isKlippyMethodBlocked(name)) return { ok: false, reason: `method is blocked: ${name}` };
  if (!isPlainObject(params)) return { ok: false, reason: 'params must be a plain object' };
  if ('response_template' in params) return { ok: false, reason: 'params must not set response_template' };
  return { ok: true, method: name, params };
}

export interface KlippyStreamDeps {
  /** Полный адрес моста (с `?token=`, если он есть) на момент подключения. */
  url: () => string;
  webSocketFactory: WebSocketFactory;
  baseReconnectDelay: number;
  maxReconnectDelay: number;
}

export interface KlippyStream {
  subscribe(
    method: string,
    params: Record<string, unknown>,
    onData: (data: unknown) => void,
    onStatus?: (status: KlippyStreamStatus) => void,
    onAck?: (result: unknown) => void,
  ): () => void;
  request(method: string, params?: Record<string, unknown>, options?: KlippyRequestOptions): Promise<unknown>;
  dispose(): void;
}

interface Sub {
  onData: (data: unknown) => void;
  onStatus?: (status: KlippyStreamStatus) => void;
  onAck?: (result: unknown) => void;
}

interface Group {
  groupKey: string;
  method: string;
  params: Record<string, unknown>;
  /** Ключ response_template текущей подписки Klipper; null — ещё не отправлена. */
  streamKey: string | null;
  failed: boolean;
  /** Result of the subscribe ack on the current socket (replayed to late joiners); undefined until it arrives. */
  ack: { result: unknown } | undefined;
  subs: Set<Sub>;
}

/** One in-flight `request()`: queued until the socket opens, then waiting for its answer. */
interface PendingRequest {
  method: string;
  params: Record<string, unknown>;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** `ws(s)://host/websocket` → `ws(s)://host/klippysocket` (сохраняет префикс пути и query). */
export function toKlippySocketUrl(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    url.pathname = url.pathname.replace(/\/websocket\/?$/, '') + '/klippysocket';
    return url.toString();
  } catch {
    return wsUrl.replace(/\/websocket(\?|$)/, '/klippysocket$1');
  }
}

export function createKlippyStream(deps: KlippyStreamDeps): KlippyStream {
  const groups = new Map<string, Group>();
  const pending = new Map<number, Group>();
  const requests = new Map<number, PendingRequest>();

  let ws: WebSocketLike | null = null;
  let open = false;
  let status: KlippyStreamStatus = 'connecting';
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  let nextKey = 1;
  let disposed = false;

  function groupKeyFor(method: string, params: Record<string, unknown>): string {
    return `${method}:${canonicalJson(params)}`;
  }

  function setStatus(next: KlippyStreamStatus): void {
    if (status === next) return;
    status = next;
    for (const g of groups.values()) {
      if (!g.failed) notify(g, next);
    }
  }

  function notify(group: Group, s: KlippyStreamStatus): void {
    for (const sub of Array.from(group.subs)) {
      try {
        sub.onStatus?.(s);
      } catch (e) {
        console.error('[klippy-stream] status callback failed', e);
      }
    }
  }

  /** True while something needs the socket: a stream group or an unanswered request. */
  function inUse(): boolean {
    return groups.size > 0 || requests.size > 0;
  }

  /** Rejects every in-flight request (socket lost or closed) and forgets them. */
  function failRequests(reason: string): void {
    for (const req of Array.from(requests.values())) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    requests.clear();
  }

  function cancelIdleClose(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  /** Closes an unused socket after a short pause, so request bursts reuse one connection. */
  function scheduleIdleClose(): void {
    if (disposed || inUse() || idleTimer !== null || !ws) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (inUse()) return;
      closeSocket();
      attempts = 0;
      status = 'connecting';
    }, IDLE_CLOSE_MS);
  }

  function closeSocket(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    cancelIdleClose();
    pending.clear();
    open = false;
    const socket = ws;
    ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }

  function connect(): void {
    if (disposed || ws || !inUse()) return;

    let socket: WebSocketLike;
    try {
      socket = deps.webSocketFactory(deps.url());
    } catch {
      failRequests('klippy bridge is unavailable');
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      open = true;
      attempts = 0;
      setStatus('live');
      for (const g of groups.values()) sendSubscribe(g);
      for (const [id, req] of requests) sendRequest(id, req);
    };
    socket.onmessage = (event) => {
      if (ws === socket) handleMessage(event.data);
    };
    const lost = () => {
      if (ws !== socket) return;
      ws = null;
      open = false;
      pending.clear();
      for (const g of groups.values()) {
        g.streamKey = null;
        g.ack = undefined;
      }
      // A one-shot request is not retried: its answer would arrive on a new session.
      failRequests('klippy bridge connection lost');
      setStatus('unavailable');
      scheduleReconnect();
    };
    socket.onclose = lost;
    socket.onerror = lost;
  }

  function scheduleReconnect(): void {
    if (disposed || timer !== null || groups.size === 0) return;
    const delay = Math.min(deps.baseReconnectDelay * 2 ** attempts, deps.maxReconnectDelay);
    attempts += 1;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
  }

  function sendSubscribe(group: Group): void {
    if (!ws || !open || group.streamKey !== null) return;
    const id = nextId++;
    const streamKey = `tessera:${nextKey++}`;
    group.streamKey = streamKey;
    group.failed = false;
    pending.set(id, group);
    try {
      ws.send(
        JSON.stringify({
          id,
          method: group.method,
          params: { ...group.params, response_template: { key: streamKey } },
        }),
      );
    } catch {
      pending.delete(id);
      group.streamKey = null;
    }
  }

  function sendRequest(id: number, req: PendingRequest): void {
    if (!ws || !open || req.sent) return;
    req.sent = true;
    try {
      ws.send(JSON.stringify({ id, method: req.method, params: req.params }));
    } catch {
      requests.delete(id);
      clearTimeout(req.timer);
      req.reject(new Error('klippy bridge send failed'));
      scheduleIdleClose();
    }
  }

  function handleMessage(raw: string): void {
    let msg: { id?: unknown; key?: unknown; params?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const group = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) {
        // Klipper отклонил подписку (нет такого load_cell, не готов): без ретраев,
        // сокет остаётся для других групп.
        group.failed = true;
        notify(group, 'unavailable');
      } else {
        group.ack = { result: msg.result };
        for (const sub of Array.from(group.subs)) deliverAck(sub, msg.result);
      }
      return;
    }
    if (typeof msg.id === 'number' && requests.has(msg.id)) {
      const req = requests.get(msg.id)!;
      requests.delete(msg.id);
      clearTimeout(req.timer);
      if (msg.error) {
        const detail = (msg.error as { message?: unknown } | null)?.message;
        req.reject(new Error(typeof detail === 'string' && detail ? detail : 'klippy request failed'));
      } else {
        req.resolve(msg.result);
      }
      scheduleIdleClose();
      return;
    }
    if (typeof msg.key !== 'string') return;
    for (const g of groups.values()) {
      if (g.streamKey !== msg.key) continue;
      for (const sub of Array.from(g.subs)) {
        try {
          sub.onData(msg.params);
        } catch (e) {
          console.error('[klippy-stream] data callback failed', e);
        }
      }
      return;
    }
  }

  function deliverAck(sub: Sub, result: unknown): void {
    try {
      sub.onAck?.(result);
    } catch (e) {
      console.error('[klippy-stream] ack callback failed', e);
    }
  }

  function subscribe(
    method: string,
    params: Record<string, unknown>,
    onData: (data: unknown) => void,
    onStatus?: (s: KlippyStreamStatus) => void,
    onAck?: (result: unknown) => void,
  ): () => void {
    if (disposed) return () => {};
    const call = checkCall(method, params);
    if (!call.ok) {
      console.warn(`[moonraker-proxy] klippyStream() refused (${call.reason})`);
      return () => {};
    }

    const key = groupKeyFor(call.method, call.params);
    let group = groups.get(key);
    if (!group) {
      group = {
        groupKey: key,
        method: call.method,
        params: call.params,
        streamKey: null,
        failed: false,
        ack: undefined,
        subs: new Set(),
      };
      groups.set(key, group);
    }
    cancelIdleClose();
    const sub: Sub = { onData, onStatus, onAck };
    group.subs.add(sub);

    if (onStatus) {
      try {
        onStatus(group.failed ? 'unavailable' : status);
      } catch (e) {
        console.error('[klippy-stream] status callback failed', e);
      }
    }
    // A stream that is already running has delivered its ack; hand the same one to the newcomer.
    if (group.ack) deliverAck(sub, group.ack.result);

    if (!ws) connect();
    else sendSubscribe(group);

    return () => {
      const g = groups.get(key);
      if (!g || !g.subs.delete(sub)) return;
      if (g.subs.size > 0) return;
      groups.delete(key);
      const streaming = g.streamKey !== null;
      if (groups.size === 0) {
        // In-flight requests keep the socket until they settle; otherwise it closes right away.
        if (requests.size === 0) {
          closeSocket();
          attempts = 0;
          status = 'connecting';
        }
      } else if (streaming) {
        // Отписки в Klipper нет: гасим поток, пересоздав сокет для оставшихся групп.
        // Requests in flight on the old socket die with it, so they are rejected.
        failRequests('klippy bridge restarted');
        closeSocket();
        status = 'connecting';
        for (const other of groups.values()) {
          other.streamKey = null;
          other.ack = undefined;
        }
        connect();
      }
    };
  }

  function request(
    method: string,
    params: Record<string, unknown> = {},
    options: KlippyRequestOptions = {},
  ): Promise<unknown> {
    if (disposed) return Promise.reject(new Error('klippy bridge is disposed'));
    const call = checkCall(method, params);
    if (!call.ok) return Promise.reject(new Error(`klippyRequest() refused (${call.reason})`));

    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      const req: PendingRequest = {
        method: call.method,
        params: call.params,
        sent: false,
        timer: setTimeout(() => {
          if (requests.delete(id)) {
            reject(new Error(`klippy request timed out: ${call.method}`));
            scheduleIdleClose();
          }
        }, timeoutMs),
        resolve,
        reject,
      };
      requests.set(id, req);
      cancelIdleClose();
      if (!ws) connect();
      else sendRequest(id, req);
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    failRequests('klippy bridge is disposed');
    closeSocket();
    groups.clear();
  }

  return { subscribe, request, dispose };
}
